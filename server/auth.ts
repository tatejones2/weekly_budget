import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.ts';

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, key] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export const SESSION_COOKIE = 'weekly_session';
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session row and sets the cookie on `response`. */
export async function createSession(userId: string, response: Response): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, hashToken(token), expiresAt]);
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

/** Deletes the session row (if any) and clears the cookie. */
export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = request.cookies?.[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
}

// `P` lets each route handler declare its own `:param` shape (e.g. `{ id: string }`)
// as a plain property instead of an index signature — avoids `noUncheckedIndexedAccess`
// widening every `request.params.x` read to `string | string[] | undefined`.
export type AuthedRequest<P = Record<string, never>> = Request<P> & { user?: { id: string; email: string; name: string | null } };

/** Rejects with 401 unless a valid, unexpired session cookie is present; otherwise attaches `request.user`. */
export async function requireUser(request: AuthedRequest<any>, response: Response, next: NextFunction): Promise<void> {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) {
    response.status(401).json({ message: 'Sign in to continue.' });
    return;
  }
  const result = await pool.query(
    `SELECT users.id, users.email, users.name
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
    [hashToken(token)],
  );
  if (!result.rowCount) {
    response.status(401).json({ message: 'Your session has expired. Sign in again.' });
    return;
  }
  request.user = result.rows[0];
  next();
}
