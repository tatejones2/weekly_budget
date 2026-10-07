// @vitest-environment node
import { pool } from './db.ts';
import * as repo from './repo.ts';
import { buildBackup } from '../src/lib/backup.ts';

/**
 * Server-side port of src/tests/backup.test.ts. Runs against a REAL Postgres
 * (DATABASE_URL must point at a disposable test database with the schema
 * already migrated — see package.json's `test:server` script). Each test
 * gets a fresh user row instead of a fresh Dexie instance; no truncation is
 * needed between tests since every query is scoped by user_id.
 */

let n = 0;
async function createTestUser(): Promise<string> {
  const email = `test-${Date.now()}-${n++}@example.com`;
  const { rows } = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, 'scrypt:x:x']);
  return rows[0].id;
}

async function seed(userId: string) {
  await repo.completeOnboarding(userId, { baseAllowanceCents: 15000, firstWeekStart: '2026-09-07', openingCarryoverCents: -1250, timeZone: 'America/New_York' });
  const t = await repo.addTemplate(userId, { merchantName: 'Bojangles', label: 'Usual order', kind: 'fixed', amountCents: 1567, categoryId: 'cat-dining' });
  await repo.addTemplate(userId, { merchantName: 'Grocery store', label: 'Groceries', kind: 'variable', amountCents: null, categoryId: 'cat-groceries' });
  await repo.addExpense(userId, { merchantName: 'Bojangles', amountCents: 1567, type: 'expense', categoryId: 'cat-dining', date: '2026-09-08', templateId: t.id });
  await repo.addExpense(userId, { merchantName: 'Bojangles', amountCents: 1567, type: 'expense', categoryId: 'cat-dining', date: '2026-09-08', templateId: t.id }); // identical duplicate
  await repo.addExpense(userId, { merchantName: 'Grocery store', amountCents: 8243, type: 'expense', categoryId: 'cat-groceries', date: '2026-09-10', note: 'weekly, "big" shop' });
  await repo.addExpense(userId, { merchantName: 'Grocery store', amountCents: 500, type: 'refund', categoryId: 'cat-groceries', date: '2026-09-11' });
  await repo.setBudgetChange(userId, '2026-09-21', 17500);
  return t;
}

describe('repo (server)', () => {
  it('keeps two identical purchases as separate rows', async () => {
    const userId = await createTestUser();
    await seed(userId);
    const data = await repo.getAppData(userId);
    const rows = data!.expenses.filter((e) => e.merchantName === 'Bojangles');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('counts template usage but never changes template amount when an expense is edited', async () => {
    const userId = await createTestUser();
    const tpl = await seed(userId);
    const data = await repo.getAppData(userId);
    const exp = data!.expenses.find((e) => e.templateId === tpl.id)!;
    await repo.updateExpense(userId, exp.id, { merchantName: 'Bojangles', amountCents: 1700, type: 'expense', categoryId: 'cat-dining', date: exp.date });
    const after = await repo.getAppData(userId);
    expect(after!.expenses.find((e) => e.id === exp.id)!.amountCents).toBe(1700);
    expect(after!.templates.find((t) => t.id === tpl.id)!.amountCents).toBe(1567);
    expect(after!.templates.find((t) => t.id === tpl.id)!.usageCount).toBe(2);
  });

  it('reuses the existing spelling of a merchant (case-insensitive)', async () => {
    const userId = await createTestUser();
    await seed(userId);
    const e = await repo.addExpense(userId, { merchantName: '  bojangles ', amountCents: 100, type: 'expense', categoryId: 'cat-dining', date: '2026-09-09' });
    expect(e.merchantName).toBe('Bojangles');
  });

  it('deletes and restores an expense (undo)', async () => {
    const userId = await createTestUser();
    await seed(userId);
    const before = (await repo.getAppData(userId))!.expenses;
    const target = before[0]!;
    const removed = await repo.deleteExpense(userId, target.id);
    expect((await repo.getAppData(userId))!.expenses).toHaveLength(before.length - 1);
    await repo.restoreExpense(userId, removed!);
    const restored = (await repo.getAppData(userId))!.expenses.find((e) => e.id === target.id);
    expect(restored).toEqual(target);
  });

  it('renames and merges merchants across expenses and templates', async () => {
    const userId = await createTestUser();
    await seed(userId);
    await repo.addExpense(userId, { merchantName: 'Bojangle', amountCents: 900, type: 'expense', categoryId: 'cat-dining', date: '2026-09-12' });
    const changed = await repo.renameMerchant(userId, 'Bojangle', 'bojangles');
    expect(changed).toBe(1);
    const data = await repo.getAppData(userId);
    expect(data!.expenses.some((e) => e.merchantName === 'Bojangle')).toBe(false);
    expect(data!.expenses.filter((e) => e.merchantName === 'Bojangles')).toHaveLength(3);
  });

  it('moves transactions when a category is deleted, and rejects duplicate category names', async () => {
    const userId = await createTestUser();
    await seed(userId);
    await repo.deleteCategory(userId, 'cat-groceries', 'cat-other');
    const data = await repo.getAppData(userId);
    expect(data!.categories.some((c) => c.id === 'cat-groceries')).toBe(false);
    expect(data!.expenses.every((e) => e.categoryId !== 'cat-groceries')).toBe(true);
    expect(data!.templates.every((t) => t.categoryId !== 'cat-groceries')).toBe(true);
    expect(await repo.addCategory(userId, 'dining')).toBeNull();
  });

  it('deleting a template leaves purchases intact (FK sets template_id to null)', async () => {
    const userId = await createTestUser();
    const tpl = await seed(userId);
    const before = (await repo.getAppData(userId))!.expenses.length;
    await repo.deleteTemplate(userId, tpl.id);
    const data = await repo.getAppData(userId);
    expect(data!.expenses).toHaveLength(before);
    expect(data!.expenses.some((e) => e.templateId === tpl.id)).toBe(false);
  });

  it('replaces a budget change on the same Monday instead of stacking', async () => {
    const userId = await createTestUser();
    await seed(userId);
    await repo.setBudgetChange(userId, '2026-09-21', 20000);
    const data = await repo.getAppData(userId);
    const same = data!.budgetChanges.filter((c) => c.effectiveWeekStart === '2026-09-21');
    expect(same).toHaveLength(1);
    expect(same[0]!.baseAllowanceCents).toBe(20000);
  });

  it('never deletes the last remaining budget change', async () => {
    const userId = await createTestUser();
    await repo.completeOnboarding(userId, { baseAllowanceCents: 15000, firstWeekStart: '2026-09-07', openingCarryoverCents: 0, timeZone: 'UTC' });
    const data = await repo.getAppData(userId);
    expect(data!.budgetChanges).toHaveLength(1);
    await repo.deleteBudgetChange(userId, data!.budgetChanges[0]!.id);
    expect((await repo.getAppData(userId))!.budgetChanges).toHaveLength(1);
  });

  it('fully isolates data between two users', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await seed(a);
    await repo.completeOnboarding(b, { baseAllowanceCents: 15000, firstWeekStart: '2026-09-07', openingCarryoverCents: 0, timeZone: 'UTC' });
    const dataB = await repo.getAppData(b);
    expect(dataB!.expenses).toHaveLength(0);
    expect(dataB!.templates).toHaveLength(0);
  });

  it('round-trips a JSON backup through buildBackup -> restoreBackupData', async () => {
    const userId = await createTestUser();
    await seed(userId);
    const before = await repo.getAppData(userId);
    const backup = buildBackup(before as any, '2026-09-19T12:00:00.000Z');

    const other = await createTestUser();
    await repo.completeOnboarding(other, { baseAllowanceCents: 99999, firstWeekStart: '2025-01-06', openingCarryoverCents: 0, timeZone: 'UTC' });
    const result = await repo.restoreBackupData(other, backup);
    expect(result.ok).toBe(true);

    const after = await repo.getAppData(other);
    const sortById = <T extends { id: string }>(x: T[]) => [...x].sort((p, q) => p.id.localeCompare(q.id));
    expect(sortById(after!.expenses)).toEqual(sortById(before!.expenses));
    expect(sortById(after!.templates)).toEqual(sortById(before!.templates));
    expect(sortById(after!.budgetChanges)).toEqual(sortById(before!.budgetChanges));
    expect(after!.settings).toMatchObject({ firstWeekStart: '2026-09-07', openingCarryoverCents: -1250, timeZone: 'America/New_York' });
  });

  it('rejects an invalid backup without touching existing data', async () => {
    const userId = await createTestUser();
    await seed(userId);
    const before = await repo.getAppData(userId);
    const result = await repo.restoreBackupData(userId, { app: 'weekly-budget', schemaVersion: 1, settings: {}, expenses: [] });
    expect(result.ok).toBe(false);
    expect(await repo.getAppData(userId)).toEqual(before);
  });

  it('clearAllData only clears the acting user', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    await seed(a);
    await seed(b);
    await repo.clearAllData(a);
    expect(await repo.getAppData(a)).toBeNull();
    expect((await repo.getAppData(b))!.expenses.length).toBeGreaterThan(0);
  });
});
