import { WeeklyDB } from '../db/db';
import { buildBackup, parseBackupText, readAppData, restoreBackup, validateBackup } from '../db/backup';
import { expensesToCsv } from '../db/csv';
import { addCategory, addExpense, addTemplate, clearAllData, completeOnboarding, deleteCategory, deleteExpense, deleteTemplate, renameMerchant, restoreExpense, setBudgetChange, updateExpense } from '../db/repo';

let n = 0;
const freshDb = () => new WeeklyDB(`test-${Date.now()}-${n++}`);

async function seed(db: WeeklyDB) {
  await completeOnboarding({ baseAllowanceCents: 15000, firstWeekStart: '2026-09-07', openingCarryoverCents: -1250, timeZone: 'America/New_York' }, db);
  const t = await addTemplate({ merchantName: 'Bojangles', label: 'Usual order', kind: 'fixed', amountCents: 1567, categoryId: 'cat-dining' }, db);
  await addTemplate({ merchantName: 'Grocery store', label: 'Groceries', kind: 'variable', amountCents: null, categoryId: 'cat-groceries' }, db);
  await addExpense({ merchantName: 'Bojangles', amountCents: 1567, type: 'expense', categoryId: 'cat-dining', date: '2026-09-08', templateId: t.id }, db);
  await addExpense({ merchantName: 'Bojangles', amountCents: 1567, type: 'expense', categoryId: 'cat-dining', date: '2026-09-08', templateId: t.id }, db); // identical duplicate
  await addExpense({ merchantName: 'Grocery store', amountCents: 8243, type: 'expense', categoryId: 'cat-groceries', date: '2026-09-10', note: 'weekly, "big" shop' }, db);
  await addExpense({ merchantName: 'Grocery store', amountCents: 500, type: 'refund', categoryId: 'cat-groceries', date: '2026-09-11' }, db);
  await setBudgetChange('2026-09-21', 17500, db);
}

describe('repository', () => {
  it('keeps two identical purchases as separate rows', async () => {
    const db = freshDb();
    await seed(db);
    const rows = (await db.expenses.toArray()).filter((e) => e.merchantName === 'Bojangles');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('counts template usage but never changes template amount when an expense is edited', async () => {
    const db = freshDb();
    await seed(db);
    const tpl = (await db.templates.toArray()).find((t) => t.kind === 'fixed')!;
    expect(tpl.usageCount).toBe(2);
    const exp = (await db.expenses.toArray()).find((e) => e.templateId === tpl.id)!;
    await updateExpense(exp.id, { merchantName: 'Bojangles', amountCents: 1700, type: 'expense', categoryId: 'cat-dining', date: exp.date }, db);
    expect((await db.expenses.get(exp.id))!.amountCents).toBe(1700);
    expect((await db.templates.get(tpl.id))!.amountCents).toBe(1567);
  });

  it('reuses the existing spelling of a merchant (case-insensitive)', async () => {
    const db = freshDb();
    await seed(db);
    const e = await addExpense({ merchantName: '  bojangles ', amountCents: 100, type: 'expense', categoryId: 'cat-dining', date: '2026-09-09' }, db);
    expect(e.merchantName).toBe('Bojangles');
  });

  it('deletes and restores an expense (undo)', async () => {
    const db = freshDb();
    await seed(db);
    const before = await db.expenses.count();
    const target = (await db.expenses.toArray())[0]!;
    const removed = await deleteExpense(target.id, db);
    expect(await db.expenses.count()).toBe(before - 1);
    await restoreExpense(removed!, db);
    expect(await db.expenses.get(target.id)).toEqual(target);
  });

  it('renames and merges merchants across expenses and templates', async () => {
    const db = freshDb();
    await seed(db);
    await addExpense({ merchantName: 'Bojangle', amountCents: 900, type: 'expense', categoryId: 'cat-dining', date: '2026-09-12' }, db);
    const changed = await renameMerchant('Bojangle', 'bojangles', db);
    expect(changed).toBe(1);
    const names = new Set((await db.expenses.toArray()).map((e) => e.merchantName));
    expect(names.has('Bojangle')).toBe(false);
    expect((await db.expenses.toArray()).filter((e) => e.merchantName === 'Bojangles')).toHaveLength(3);
  });

  it('moves transactions when a category is deleted', async () => {
    const db = freshDb();
    await seed(db);
    await deleteCategory('cat-groceries', 'cat-other', db);
    expect(await db.categories.get('cat-groceries')).toBeUndefined();
    expect((await db.expenses.toArray()).every((e) => e.categoryId !== 'cat-groceries')).toBe(true);
    expect((await db.templates.toArray()).every((t) => t.categoryId !== 'cat-groceries')).toBe(true);
    expect(await addCategory('dining', db)).toBeNull(); // duplicate name
  });

  it('deleting a template leaves purchases intact', async () => {
    const db = freshDb();
    await seed(db);
    const tpl = (await db.templates.toArray()).find((t) => t.kind === 'fixed')!;
    const count = await db.expenses.count();
    await deleteTemplate(tpl.id, db);
    expect(await db.expenses.count()).toBe(count);
    expect((await db.expenses.toArray()).some((e) => e.templateId === tpl.id)).toBe(false);
  });

  it('replaces a budget change on the same Monday instead of stacking', async () => {
    const db = freshDb();
    await seed(db);
    await setBudgetChange('2026-09-21', 20000, db);
    const same = (await db.budgetChanges.toArray()).filter((c) => c.effectiveWeekStart === '2026-09-21');
    expect(same).toHaveLength(1);
    expect(same[0]!.baseAllowanceCents).toBe(20000);
  });
});

describe('JSON backup', () => {
  it('round-trips ledger and settings exactly', async () => {
    const a = freshDb();
    await seed(a);
    const data = (await readAppData(a))!;
    const json = JSON.stringify(buildBackup(data, '2026-09-19T12:00:00.000Z'));

    const parsed = parseBackupText(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.summary).toMatchObject({ expenses: 4, templates: 2, budgetChanges: 2, firstWeekStart: '2026-09-07' });

    const b = freshDb();
    await completeOnboarding({ baseAllowanceCents: 99999, firstWeekStart: '2025-01-06', openingCarryoverCents: 0, timeZone: 'UTC' }, b);
    await restoreBackup(parsed.backup, b);
    const restored = (await readAppData(b))!;

    const sortById = <T extends { id: string }>(x: T[]) => [...x].sort((p, q) => p.id.localeCompare(q.id));
    expect(sortById(restored.expenses)).toEqual(sortById(data.expenses));
    expect(sortById(restored.templates)).toEqual(sortById(data.templates));
    expect(sortById(restored.budgetChanges)).toEqual(sortById(data.budgetChanges));
    expect(sortById(restored.categories)).toEqual(sortById(data.categories));
    expect(restored.settings).toMatchObject({ firstWeekStart: '2026-09-07', openingCarryoverCents: -1250, timeZone: 'America/New_York', currency: 'USD' });
  });

  it('includes schemaVersion and export timestamp', async () => {
    const db = freshDb();
    await seed(db);
    const backup = buildBackup((await readAppData(db))!, '2026-09-19T12:00:00.000Z');
    expect(backup).toMatchObject({ app: 'weekly-budget', schemaVersion: 1, exportedAt: '2026-09-19T12:00:00.000Z' });
  });

  describe('rejects invalid files without touching data', () => {
    const good = async () => {
      const db = freshDb();
      await seed(db);
      return JSON.parse(JSON.stringify(buildBackup((await readAppData(db))!)));
    };
    const mutate = async (fn: (b: any) => void) => {
      const b = await good();
      fn(b);
      return validateBackup(b);
    };

    it.each([
      ['not JSON', () => parseBackupText('{nope')],
      ['wrong app', () => validateBackup({ app: 'other', schemaVersion: 1 })],
      ['array', () => validateBackup([])],
      ['null', () => validateBackup(null)],
    ])('%s', (_n, run) => {
      expect(run().ok).toBe(false);
    });

    it('newer schema version', async () => expect((await mutate((b) => (b.schemaVersion = 99))).ok).toBe(false));
    it('float cents', async () => expect((await mutate((b) => (b.expenses[0].amountCents = 15.67))).ok).toBe(false));
    it('zero amount', async () => expect((await mutate((b) => (b.expenses[0].amountCents = 0))).ok).toBe(false));
    it('negative amount', async () => expect((await mutate((b) => (b.expenses[0].amountCents = -5))).ok).toBe(false));
    it('string amount', async () => expect((await mutate((b) => (b.expenses[0].amountCents = '1567'))).ok).toBe(false));
    it('bad date', async () => expect((await mutate((b) => (b.expenses[0].date = '2026-02-31'))).ok).toBe(false));
    it('empty merchant', async () => expect((await mutate((b) => (b.expenses[0].merchantName = '  '))).ok).toBe(false));
    it('duplicate expense ids', async () => expect((await mutate((b) => (b.expenses[1].id = b.expenses[0].id))).ok).toBe(false));
    it('duplicate category ids', async () => expect((await mutate((b) => (b.categories[1].id = b.categories[0].id))).ok).toBe(false));
    it('unknown category reference', async () => expect((await mutate((b) => (b.expenses[0].categoryId = 'nope'))).ok).toBe(false));
    it('fixed template without amount', async () => expect((await mutate((b) => (b.templates.find((t: any) => t.kind === 'fixed').amountCents = null))).ok).toBe(false));
    it('variable template with an amount', async () => expect((await mutate((b) => (b.templates.find((t: any) => t.kind === 'variable').amountCents = 8243))).ok).toBe(false));
    it('non-Monday first week', async () => expect((await mutate((b) => (b.settings.firstWeekStart = '2026-09-09'))).ok).toBe(false));
    it('bad time zone', async () => expect((await mutate((b) => (b.settings.timeZone = 'Mars/Base'))).ok).toBe(false));
    it('missing expenses', async () => expect((await mutate((b) => delete b.expenses)).ok).toBe(false));

    it('leaves existing data untouched when validation fails', async () => {
      const db = freshDb();
      await seed(db);
      const before = await db.expenses.count();
      const result = parseBackupText(JSON.stringify({ app: 'weekly-budget', schemaVersion: 1, settings: {}, expenses: [] }));
      expect(result.ok).toBe(false);
      expect(await db.expenses.count()).toBe(before);
    });
  });
});

describe('clear all data', () => {
  it('empties every table', async () => {
    const db = freshDb();
    await seed(db);
    await clearAllData(db);
    expect(await readAppData(db)).toBeNull();
    expect(await db.expenses.count()).toBe(0);
  });
});

describe('CSV export', () => {
  it('escapes cells, signs refunds, and neutralises formulas', async () => {
    const db = freshDb();
    await seed(db);
    await addExpense({ merchantName: '=HYPERLINK("x")', amountCents: 100, type: 'expense', categoryId: 'cat-other', date: '2026-09-13' }, db);
    const data = (await readAppData(db))!;
    const csv = expensesToCsv(data.expenses, data.categories);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Merchant,Category,Type,Amount,Note');
    expect(csv).toContain('2026-09-10,Grocery store,Groceries,Expense,82.43,"weekly, ""big"" shop"');
    expect(csv).toContain('Refund,-5.00');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
