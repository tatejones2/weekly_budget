import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { pool } from './db.ts';
import { createSession, destroySession, hashPassword, requireUser, verifyPassword, type AuthedRequest } from './auth.ts';
import * as repo from './repo.ts';
import { isValidISODate, isValidTimeZone, weekdayIndex } from '../src/lib/dates.ts';
import { isValidCents } from '../src/lib/money.ts';
import { MAX_NOTE } from '../src/lib/validation.ts';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Defense in depth: same-origin in production (the server serves the SPA
// itself), but reject anything claiming a different Origin on state-changing
// requests regardless.
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (request.method !== 'GET' && request.method !== 'HEAD' && origin && origin !== FRONTEND_URL) {
    response.status(403).json({ message: 'Request origin is not allowed.' });
    return;
  }
  next();
});

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch {
    response.status(503).json({ status: 'db unavailable' });
  }
});

// ---------- validation helpers shared across routes ----------

const centsSigned = z.number().refine((n) => isValidCents(n), 'Invalid amount.');
const centsPositive = z.number().refine((n) => isValidCents(n, { min: 1 }), 'Amount must be greater than $0.00.');
const centsNonNegative = z.number().refine((n) => isValidCents(n, { min: 0 }), 'Invalid amount.');
const isoDate = z.string().refine((s) => isValidISODate(s), 'Invalid date.');
const mondayDate = isoDate.refine((s) => weekdayIndex(s) === 0, 'Must be a Monday.');
const timeZone = z.string().refine((s) => isValidTimeZone(s), 'Invalid time zone.');

const expenseWriteSchema = z.object({
  merchantName: z.string().trim().min(1, 'Enter a place or payee.').max(200),
  amountCents: centsPositive,
  type: z.enum(['expense', 'refund']),
  categoryId: z.string().min(1),
  date: isoDate,
  note: z.string().max(MAX_NOTE).optional(),
  templateId: z.string().optional(),
});

const templateWriteSchema = z
  .object({
    merchantName: z.string().trim().min(1, 'Enter a place.').max(200),
    label: z.string().max(80).optional().default(''),
    kind: z.enum(['fixed', 'variable']),
    amountCents: z.number().nullable(),
    categoryId: z.string().min(1),
  })
  .refine((v) => (v.kind === 'fixed' ? isValidCents(v.amountCents, { min: 1 }) : v.amountCents === null), {
    message: 'Amount does not match the shortcut type.',
    path: ['amountCents'],
  });

function handleZodError(error: unknown, response: Response): boolean {
  if (error instanceof z.ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? 'Invalid request.' });
    return true;
  }
  return false;
}

// ============================= Auth =============================

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
});

app.post('/api/auth/register', authLimit, async (request, response) => {
  try {
    const values = credentialsSchema.extend({ name: z.string().trim().min(1).max(80).optional() }).parse(request.body);
    const passwordHash = await hashPassword(values.password);
    const result = await pool.query('INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name', [
      values.email,
      values.name ?? null,
      passwordHash,
    ]);
    await createSession(result.rows[0].id, response);
    response.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') return void response.status(409).json({ message: 'An account with that email already exists.' });
    if (handleZodError(error, response)) return;
    console.error(error);
    response.status(500).json({ message: 'We could not create your account.' });
  }
});

app.post('/api/auth/login', authLimit, async (request, response) => {
  try {
    const values = credentialsSchema.parse(request.body);
    const result = await pool.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [values.email]);
    if (!result.rowCount || !(await verifyPassword(values.password, result.rows[0].password_hash))) {
      return void response.status(401).json({ message: 'Email or password is incorrect.' });
    }
    await createSession(result.rows[0].id, response);
    const { password_hash: _unused, ...user } = result.rows[0];
    response.json({ user });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'We could not sign you in.' });
  }
});

app.post('/api/auth/logout', async (request, response) => {
  await destroySession(request, response);
  response.status(204).end();
});

app.get('/api/auth/me', requireUser as any, (request: AuthedRequest, response) => {
  response.json({ user: request.user });
});

// ===================== Everything below requires a session =====================

app.use('/api', (request, response, next) => {
  if (request.path.startsWith('/auth/') || request.path === '/health') return next();
  requireUser(request as AuthedRequest, response, next as NextFunction);
});

app.get('/api/data', async (request: AuthedRequest, response) => {
  const data = await repo.getAppData(request.user!.id);
  response.json(data ?? { settings: null, budgetChanges: [], categories: [], templates: [], expenses: [] });
});

app.delete('/api/data', async (request: AuthedRequest, response) => {
  await repo.clearAllData(request.user!.id);
  response.status(204).end();
});

app.post('/api/onboarding', async (request: AuthedRequest, response) => {
  try {
    const values = z
      .object({ baseAllowanceCents: centsNonNegative, firstWeekStart: isoDate, openingCarryoverCents: centsSigned, timeZone })
      .parse(request.body);
    const settings = await repo.completeOnboarding(request.user!.id, values);
    response.status(201).json({ settings });
  } catch (error) {
    if (handleZodError(error, response)) return;
    console.error(error);
    response.status(500).json({ message: 'Could not save your setup.' });
  }
});

app.patch('/api/settings', async (request: AuthedRequest, response) => {
  try {
    const values = z.object({ timeZone: timeZone.optional(), lastBackupAt: z.string().optional() }).parse(request.body);
    const settings = await repo.updateSettings(request.user!.id, values);
    response.json({ settings });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not update settings.' });
  }
});

app.put('/api/settings/start', async (request: AuthedRequest, response) => {
  try {
    const values = z.object({ firstWeekStart: isoDate, openingCarryoverCents: centsSigned }).parse(request.body);
    const settings = await repo.updateStartAndOpening(request.user!.id, values);
    response.json({ settings });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not update your start date.' });
  }
});

app.put('/api/budget-changes', async (request: AuthedRequest, response) => {
  try {
    const values = z.object({ effectiveWeekStart: mondayDate, baseAllowanceCents: centsNonNegative }).parse(request.body);
    const budgetChange = await repo.setBudgetChange(request.user!.id, values.effectiveWeekStart, values.baseAllowanceCents);
    response.json({ budgetChange });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not save that budget change.' });
  }
});

app.delete('/api/budget-changes/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  await repo.deleteBudgetChange(request.user!.id, request.params.id);
  response.status(204).end();
});

app.post('/api/categories', async (request: AuthedRequest, response) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(40) }).parse(request.body);
    const category = await repo.addCategory(request.user!.id, name);
    if (!category) return void response.status(409).json({ message: 'Enter a new, unique category name.' });
    response.status(201).json({ category });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not add that category.' });
  }
});

app.patch('/api/categories/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(40) }).parse(request.body);
    const ok = await repo.renameCategory(request.user!.id, request.params.id, name);
    if (!ok) return void response.status(409).json({ message: 'That name is empty or already used.' });
    response.json({ ok: true });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not rename that category.' });
  }
});

app.delete('/api/categories/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  try {
    const { reassignToId } = z.object({ reassignToId: z.string().min(1) }).parse(request.body);
    await repo.deleteCategory(request.user!.id, request.params.id, reassignToId);
    response.status(204).end();
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not delete that category.' });
  }
});

app.patch('/api/merchants/rename', async (request: AuthedRequest, response) => {
  try {
    const { from, to } = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(request.body);
    const changed = await repo.renameMerchant(request.user!.id, from, to);
    response.json({ changed });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not rename that place.' });
  }
});

app.post('/api/templates', async (request: AuthedRequest, response) => {
  try {
    const values = templateWriteSchema.parse(request.body);
    const template = await repo.addTemplate(request.user!.id, values);
    response.status(201).json({ template });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not save that shortcut.' });
  }
});

app.patch('/api/templates/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  try {
    const values = templateWriteSchema.parse(request.body);
    await repo.updateTemplate(request.user!.id, request.params.id, values);
    response.json({ ok: true });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not update that shortcut.' });
  }
});

app.delete('/api/templates/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  await repo.deleteTemplate(request.user!.id, request.params.id);
  response.status(204).end();
});

app.post('/api/expenses', async (request: AuthedRequest, response) => {
  try {
    const values = expenseWriteSchema.parse(request.body);
    const expense = await repo.addExpense(request.user!.id, values);
    response.status(201).json({ expense });
  } catch (error) {
    if (handleZodError(error, response)) return;
    console.error(error);
    response.status(500).json({ message: 'Could not save that expense.' });
  }
});

app.patch('/api/expenses/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  try {
    const values = expenseWriteSchema.parse(request.body);
    const expense = await repo.updateExpense(request.user!.id, request.params.id, values);
    response.json({ expense });
  } catch (error) {
    if (handleZodError(error, response)) return;
    response.status(500).json({ message: 'Could not update that expense.' });
  }
});

app.delete('/api/expenses/:id', async (request: AuthedRequest<{ id: string }>, response) => {
  const expense = await repo.deleteExpense(request.user!.id, request.params.id);
  response.json({ expense: expense ?? null });
});

app.post('/api/expenses/:id/restore', async (request: AuthedRequest<{ id: string }>, response) => {
  const expense = { ...request.body, id: request.params.id };
  await repo.restoreExpense(request.user!.id, expense);
  response.status(201).json({ expense });
});

app.post('/api/backup/restore', async (request: AuthedRequest, response) => {
  const result = await repo.restoreBackupData(request.user!.id, request.body);
  if (!result.ok) return void response.status(400).json({ message: result.errors[0] ?? 'That file could not be imported.', errors: result.errors });
  response.json({ ok: true });
});

// ---------- production: serve the compiled SPA from the same origin ----------

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));
  app.get('*splat', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
}

// ---------- global error handler (must be last) ----------

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ message: 'Something went wrong.' });
});
