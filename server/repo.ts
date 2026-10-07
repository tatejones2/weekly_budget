import type { PoolClient } from 'pg';
import { pool, transaction } from './db.ts';
import { cleanText, normalizeName, MAX_NOTE } from '../src/lib/validation.ts';
import { weekStartOf } from '../src/lib/dates.ts';
import { STARTER_CATEGORIES } from '../src/db/defaults.ts';
import { validateBackup, type BackupResult } from '../src/lib/backup.ts';
import type { BackupFile, BudgetChange, Category, Expense, PurchaseTemplate } from '../src/db/types.ts';

/**
 * Server-side port of `src/db/repo.ts`. Same function names/shapes (now
 * taking `userId` first, and a real pg client/pool instead of a Dexie
 * handle) so the behavior contracts covered by the original
 * `src/tests/backup.test.ts` carry over unchanged — see `server/repo.test.ts`.
 */

const nowIso = () => new Date().toISOString();

type Queryable = Pick<PoolClient, 'query'>;

// ---------- row mappers ----------

function toExpense(r: any): Expense {
  const e: Expense = {
    id: r.id,
    merchantName: r.merchant_name,
    amountCents: r.amount_cents,
    categoryId: r.category_id,
    date: r.date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.type === 'refund') e.type = 'refund';
  if (r.note) e.note = r.note;
  if (r.template_id) e.templateId = r.template_id;
  return e;
}

function toCategory(r: any): Category {
  return { id: r.id, name: r.name, sortOrder: r.sort_order };
}

function toTemplate(r: any): PurchaseTemplate {
  const t: PurchaseTemplate = {
    id: r.id,
    merchantName: r.merchant_name,
    label: r.label,
    kind: r.kind,
    amountCents: r.amount_cents,
    categoryId: r.category_id,
    usageCount: r.usage_count,
  };
  if (r.last_used_at) t.lastUsedAt = r.last_used_at;
  return t;
}

function toBudgetChange(r: any): BudgetChange {
  return { id: r.id, effectiveWeekStart: r.effective_week_start, baseAllowanceCents: r.base_allowance_cents };
}

export type Settings = {
  firstWeekStart: string;
  openingCarryoverCents: number;
  timeZone: string;
  currency: 'USD';
  lastBackupAt?: string;
  createdAt: string;
};

function toSettings(r: any): Settings {
  const s: Settings = {
    firstWeekStart: r.first_week_start,
    openingCarryoverCents: r.opening_carryover_cents,
    timeZone: r.time_zone,
    currency: 'USD',
    createdAt: r.created_at,
  };
  if (r.last_backup_at) s.lastBackupAt = r.last_backup_at;
  return s;
}

// ---------- merchant canonicalization (indexed, not a full scan) ----------

async function canonicalMerchant(userId: string, name: string, q: Queryable): Promise<string> {
  const cleaned = cleanText(name);
  const key = normalizeName(cleaned);
  const { rows } = await q.query('SELECT merchant_name FROM expenses WHERE user_id = $1 AND merchant_name_key = $2 LIMIT 1', [userId, key]);
  return rows[0]?.merchant_name ?? cleaned;
}

// ---------- onboarding / settings ----------

export async function completeOnboarding(
  userId: string,
  input: { baseAllowanceCents: number; firstWeekStart: string; openingCarryoverCents: number; timeZone: string },
): Promise<Settings> {
  const firstWeekStart = weekStartOf(input.firstWeekStart);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO settings (user_id, first_week_start, opening_carryover_cents, time_zone, currency)
       VALUES ($1, $2, $3, $4, 'USD') RETURNING *`,
      [userId, firstWeekStart, input.openingCarryoverCents, input.timeZone],
    );
    await client.query(`INSERT INTO budget_changes (id, user_id, effective_week_start, base_allowance_cents) VALUES ($1, $2, $3, $4)`, [
      newId(),
      userId,
      firstWeekStart,
      input.baseAllowanceCents,
    ]);
    const existing = await client.query('SELECT 1 FROM categories WHERE user_id = $1 LIMIT 1', [userId]);
    if (!existing.rowCount) {
      for (const c of STARTER_CATEGORIES) {
        await client.query('INSERT INTO categories (id, user_id, name, name_key, sort_order) VALUES ($1, $2, $3, $4, $5)', [
          c.id,
          userId,
          c.name,
          normalizeName(c.name),
          c.sortOrder,
        ]);
      }
    }
    return toSettings(rows[0]);
  });
}

export async function updateSettings(userId: string, patch: { timeZone?: string; lastBackupAt?: string }): Promise<Settings> {
  const { rows } = await pool.query(
    `UPDATE settings SET
       time_zone = COALESCE($2, time_zone),
       last_backup_at = COALESCE($3, last_backup_at),
       updated_at = NOW()
     WHERE user_id = $1 RETURNING *`,
    [userId, patch.timeZone ?? null, patch.lastBackupAt ?? null],
  );
  return toSettings(rows[0]);
}

export async function updateStartAndOpening(userId: string, input: { firstWeekStart: string; openingCarryoverCents: number }): Promise<Settings> {
  const { rows } = await pool.query(
    `UPDATE settings SET first_week_start = $2, opening_carryover_cents = $3, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
    [userId, weekStartOf(input.firstWeekStart), input.openingCarryoverCents],
  );
  return toSettings(rows[0]);
}

/** Set the base allowance from `effectiveWeekStart` onward (upsert: replaces any change already on that Monday). */
export async function setBudgetChange(userId: string, effectiveWeekStart: string, baseAllowanceCents: number): Promise<BudgetChange> {
  const { rows } = await pool.query(
    `INSERT INTO budget_changes (id, user_id, effective_week_start, base_allowance_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, effective_week_start) DO UPDATE SET base_allowance_cents = EXCLUDED.base_allowance_cents
     RETURNING *`,
    [newId(), userId, effectiveWeekStart, baseAllowanceCents],
  );
  return toBudgetChange(rows[0]);
}

export async function deleteBudgetChange(userId: string, id: string): Promise<void> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM budget_changes WHERE user_id = $1', [userId]);
  if (rows[0].n <= 1) return; // always keep at least one
  await pool.query('DELETE FROM budget_changes WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------- expenses ----------

export type ExpenseWrite = {
  merchantName: string;
  amountCents: number;
  type: 'expense' | 'refund';
  categoryId: string;
  date: string;
  note?: string;
  templateId?: string;
};

export async function addExpense(userId: string, input: ExpenseWrite): Promise<Expense> {
  return transaction(async (client) => {
    const merchantName = await canonicalMerchant(userId, input.merchantName, client);
    const ts = nowIso();
    const note = input.note ? cleanText(input.note, MAX_NOTE) : null;
    const { rows } = await client.query(
      `INSERT INTO expenses (id, user_id, merchant_name, merchant_name_key, amount_cents, type, category_id, date, note, template_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [newId(), userId, merchantName, normalizeName(merchantName), input.amountCents, input.type, input.categoryId, input.date, note, input.templateId ?? null, ts],
    );
    if (input.templateId) {
      await client.query('UPDATE templates SET usage_count = usage_count + 1, last_used_at = $3 WHERE user_id = $1 AND id = $2', [userId, input.templateId, ts]);
    }
    return toExpense(rows[0]);
  });
}

export async function updateExpense(userId: string, id: string, input: ExpenseWrite): Promise<Expense | undefined> {
  const merchantName = await canonicalMerchant(userId, input.merchantName, pool);
  const note = input.note ? cleanText(input.note, MAX_NOTE) : null;
  // Editing a purchase never touches the template it came from.
  const { rows } = await pool.query(
    `UPDATE expenses SET merchant_name=$3, merchant_name_key=$4, amount_cents=$5, type=$6, category_id=$7, date=$8, note=$9, updated_at=$10
     WHERE user_id=$1 AND id=$2 RETURNING *`,
    [userId, id, merchantName, normalizeName(merchantName), input.amountCents, input.type, input.categoryId, input.date, note, nowIso()],
  );
  return rows[0] ? toExpense(rows[0]) : undefined;
}

export async function deleteExpense(userId: string, id: string): Promise<Expense | undefined> {
  const { rows } = await pool.query('DELETE FROM expenses WHERE user_id = $1 AND id = $2 RETURNING *', [userId, id]);
  return rows[0] ? toExpense(rows[0]) : undefined;
}

/** Put back an expense exactly as it was (used by Undo). */
export async function restoreExpense(userId: string, expense: Expense): Promise<void> {
  await pool.query(
    `INSERT INTO expenses (id, user_id, merchant_name, merchant_name_key, amount_cents, type, category_id, date, note, template_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, id) DO UPDATE SET
       merchant_name=EXCLUDED.merchant_name, merchant_name_key=EXCLUDED.merchant_name_key, amount_cents=EXCLUDED.amount_cents,
       type=EXCLUDED.type, category_id=EXCLUDED.category_id, date=EXCLUDED.date, note=EXCLUDED.note,
       template_id=EXCLUDED.template_id, updated_at=EXCLUDED.updated_at`,
    [
      expense.id,
      userId,
      expense.merchantName,
      normalizeName(expense.merchantName),
      expense.amountCents,
      expense.type ?? 'expense',
      expense.categoryId,
      expense.date,
      expense.note ?? null,
      expense.templateId ?? null,
      expense.createdAt,
      expense.updatedAt,
    ],
  );
}

/** Rename a merchant everywhere. If `to` matches another merchant, the two merge. Returns rows changed. */
export async function renameMerchant(userId: string, from: string, to: string): Promise<number> {
  const fromKey = normalizeName(from);
  const target = cleanText(to);
  if (!target) return 0;
  const targetKey = normalizeName(target);
  return transaction(async (client) => {
    // If merging into an existing merchant, adopt that merchant's spelling.
    const existing =
      targetKey !== fromKey
        ? await client.query('SELECT merchant_name FROM expenses WHERE user_id=$1 AND merchant_name_key=$2 LIMIT 1', [userId, targetKey])
        : { rows: [] as any[] };
    const finalName = existing.rows[0]?.merchant_name ?? target;
    const finalKey = normalizeName(finalName);
    const e = await client.query('UPDATE expenses SET merchant_name=$3, merchant_name_key=$4, updated_at=$5 WHERE user_id=$1 AND merchant_name_key=$2', [
      userId,
      fromKey,
      finalName,
      finalKey,
      nowIso(),
    ]);
    const t = await client.query('UPDATE templates SET merchant_name=$3, merchant_name_key=$4 WHERE user_id=$1 AND merchant_name_key=$2', [
      userId,
      fromKey,
      finalName,
      finalKey,
    ]);
    return (e.rowCount ?? 0) + (t.rowCount ?? 0);
  });
}

// ---------- categories ----------

export async function addCategory(userId: string, name: string): Promise<Category | null> {
  const cleaned = cleanText(name, 40);
  if (!cleaned) return null;
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories WHERE user_id = $1', [userId]);
  try {
    const { rows } = await pool.query('INSERT INTO categories (id, user_id, name, name_key, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
      newId(),
      userId,
      cleaned,
      normalizeName(cleaned),
      maxRows[0].m + 1,
    ]);
    return toCategory(rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') return null; // duplicate name
    throw error;
  }
}

export async function renameCategory(userId: string, id: string, name: string): Promise<boolean> {
  const cleaned = cleanText(name, 40);
  if (!cleaned) return false;
  try {
    const { rowCount } = await pool.query('UPDATE categories SET name=$3, name_key=$4 WHERE user_id=$1 AND id=$2', [userId, id, cleaned, normalizeName(cleaned)]);
    return (rowCount ?? 0) > 0;
  } catch (error: any) {
    if (error?.code === '23505') return false;
    throw error;
  }
}

/** Delete a category, moving its transactions and shortcuts to `reassignToId`. */
export async function deleteCategory(userId: string, id: string, reassignToId: string): Promise<void> {
  if (id === reassignToId) return;
  await transaction(async (client) => {
    await client.query('UPDATE expenses SET category_id=$3, updated_at=$4 WHERE user_id=$1 AND category_id=$2', [userId, id, reassignToId, nowIso()]);
    await client.query('UPDATE templates SET category_id=$3 WHERE user_id=$1 AND category_id=$2', [userId, id, reassignToId]);
    await client.query('DELETE FROM categories WHERE user_id=$1 AND id=$2', [userId, id]);
  });
}

// ---------- templates ----------

export type TemplateWrite = {
  merchantName: string;
  label: string;
  kind: 'fixed' | 'variable';
  amountCents: number | null;
  categoryId: string;
};

export async function addTemplate(userId: string, input: TemplateWrite): Promise<PurchaseTemplate> {
  const merchantName = await canonicalMerchant(userId, input.merchantName, pool);
  const label = cleanText(input.label) || cleanText(input.merchantName);
  const amountCents = input.kind === 'fixed' ? input.amountCents : null;
  const { rows } = await pool.query(
    `INSERT INTO templates (id, user_id, merchant_name, merchant_name_key, label, kind, amount_cents, category_id, usage_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0) RETURNING *`,
    [newId(), userId, merchantName, normalizeName(merchantName), label, input.kind, amountCents, input.categoryId],
  );
  return toTemplate(rows[0]);
}

export async function updateTemplate(userId: string, id: string, input: TemplateWrite): Promise<void> {
  const merchantName = cleanText(input.merchantName);
  const label = cleanText(input.label) || merchantName;
  const amountCents = input.kind === 'fixed' ? input.amountCents : null;
  await pool.query(
    `UPDATE templates SET merchant_name=$3, merchant_name_key=$4, label=$5, kind=$6, amount_cents=$7, category_id=$8
     WHERE user_id=$1 AND id=$2`,
    [userId, id, merchantName, normalizeName(merchantName), label, input.kind, amountCents, input.categoryId],
  );
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  // Past transactions keep their data; the FK (ON DELETE SET NULL) drops only the back-reference.
  await pool.query('DELETE FROM templates WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------- bulk read / reset / backup ----------

export type AppData = {
  settings: Settings;
  budgetChanges: BudgetChange[];
  categories: Category[];
  templates: PurchaseTemplate[];
  expenses: Expense[];
};

/** Everything this user needs in one round trip. `null` means onboarding hasn't happened yet. */
export async function getAppData(userId: string): Promise<AppData | null> {
  const settingsRes = await pool.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
  if (!settingsRes.rowCount) return null;
  const [budgetChanges, categories, templates, expenses] = await Promise.all([
    pool.query('SELECT * FROM budget_changes WHERE user_id = $1 ORDER BY effective_week_start', [userId]),
    pool.query('SELECT * FROM categories WHERE user_id = $1 ORDER BY sort_order', [userId]),
    pool.query('SELECT * FROM templates WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM expenses WHERE user_id = $1', [userId]),
  ]);
  return {
    settings: toSettings(settingsRes.rows[0]),
    budgetChanges: budgetChanges.rows.map(toBudgetChange),
    categories: categories.rows.map(toCategory),
    templates: templates.rows.map(toTemplate),
    expenses: expenses.rows.map(toExpense),
  };
}

export async function clearAllData(userId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query('DELETE FROM expenses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM templates WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM budget_changes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM settings WHERE user_id = $1', [userId]);
  });
}

export type RestoreResult = { ok: true } | { ok: false; errors: string[] };

/** Validate (again, server-side) and atomically replace everything for this user. */
export async function restoreBackupData(userId: string, raw: unknown): Promise<RestoreResult> {
  const result: BackupResult = validateBackup(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  const backup: BackupFile = result.backup;

  await transaction(async (client) => {
    await client.query('DELETE FROM expenses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM templates WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM budget_changes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await client.query(
      `INSERT INTO settings (user_id, first_week_start, opening_carryover_cents, time_zone, currency, created_at)
       VALUES ($1,$2,$3,$4,'USD',$5)
       ON CONFLICT (user_id) DO UPDATE SET first_week_start=EXCLUDED.first_week_start, opening_carryover_cents=EXCLUDED.opening_carryover_cents, time_zone=EXCLUDED.time_zone`,
      [userId, backup.settings.firstWeekStart, backup.settings.openingCarryoverCents, backup.settings.timeZone, nowIso()],
    );
    for (const c of backup.categories) {
      await client.query('INSERT INTO categories (id, user_id, name, name_key, sort_order) VALUES ($1,$2,$3,$4,$5)', [c.id, userId, c.name, normalizeName(c.name), c.sortOrder]);
    }
    for (const bc of backup.budgetChanges) {
      await client.query('INSERT INTO budget_changes (id, user_id, effective_week_start, base_allowance_cents) VALUES ($1,$2,$3,$4)', [
        bc.id,
        userId,
        bc.effectiveWeekStart,
        bc.baseAllowanceCents,
      ]);
    }
    for (const t of backup.templates) {
      await client.query(
        `INSERT INTO templates (id, user_id, merchant_name, merchant_name_key, label, kind, amount_cents, category_id, usage_count, last_used_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [t.id, userId, t.merchantName, normalizeName(t.merchantName), t.label, t.kind, t.amountCents, t.categoryId, t.usageCount, t.lastUsedAt ?? null],
      );
    }
    for (const e of backup.expenses) {
      await client.query(
        `INSERT INTO expenses (id, user_id, merchant_name, merchant_name_key, amount_cents, type, category_id, date, note, template_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [e.id, userId, e.merchantName, normalizeName(e.merchantName), e.amountCents, e.type ?? 'expense', e.categoryId, e.date, e.note ?? null, e.templateId ?? null, e.createdAt, e.updatedAt],
      );
    }
  });
  return { ok: true };
}

function newId(): string {
  return crypto.randomUUID();
}
