import { db as defaultDb, type WeeklyDB } from './db';
import { STARTER_CATEGORIES } from './defaults';
import type {
  BudgetChange,
  BudgetSettings,
  Category,
  Expense,
  PurchaseTemplate,
  StoredSettings,
} from './types';
import { newId } from '../lib/id';
import { cleanText, normalizeName, MAX_NOTE } from '../lib/validation';
import { weekStartOf } from '../lib/dates';

/**
 * Every write goes through here so views (which use Dexie live queries) update
 * automatically. Functions take an optional db handle to make tests hermetic.
 */

const nowIso = () => new Date().toISOString();

// ---------- onboarding / settings ----------

export async function completeOnboarding(
  input: { baseAllowanceCents: number; firstWeekStart: string; openingCarryoverCents: number; timeZone: string },
  db: WeeklyDB = defaultDb,
) {
  const firstWeekStart = weekStartOf(input.firstWeekStart);
  await db.transaction('rw', [db.settings, db.budgetChanges, db.categories], async () => {
    await db.settings.put({
      id: 'main',
      firstWeekStart,
      openingCarryoverCents: input.openingCarryoverCents,
      timeZone: input.timeZone,
      currency: 'USD',
      createdAt: nowIso(),
    });
    await db.budgetChanges.put({ id: newId(), effectiveWeekStart: firstWeekStart, baseAllowanceCents: input.baseAllowanceCents });
    if ((await db.categories.count()) === 0) await db.categories.bulkPut(STARTER_CATEGORIES);
  });
  try {
    await navigator.storage?.persist?.(); // ask the browser not to evict our data
  } catch {
    /* best effort */
  }
}

export async function updateSettings(patch: Partial<Omit<StoredSettings, 'id'>>, db: WeeklyDB = defaultDb) {
  await db.settings.update('main', patch);
}

/** Change the tracking start / opening balance. All later balances are derived, so they simply recompute. */
export async function updateStartAndOpening(
  input: { firstWeekStart: string; openingCarryoverCents: number },
  db: WeeklyDB = defaultDb,
) {
  await db.settings.update('main', {
    firstWeekStart: weekStartOf(input.firstWeekStart),
    openingCarryoverCents: input.openingCarryoverCents,
  });
}

/** Set the base allowance from `effectiveWeekStart` onward (replacing any change already on that Monday). */
export async function setBudgetChange(effectiveWeekStart: string, baseAllowanceCents: number, db: WeeklyDB = defaultDb) {
  await db.transaction('rw', db.budgetChanges, async () => {
    const same = await db.budgetChanges.where('effectiveWeekStart').equals(effectiveWeekStart).toArray();
    if (same.length) await db.budgetChanges.bulkDelete(same.map((c) => c.id));
    await db.budgetChanges.put({ id: newId(), effectiveWeekStart, baseAllowanceCents });
  });
}

export async function deleteBudgetChange(id: string, db: WeeklyDB = defaultDb) {
  if ((await db.budgetChanges.count()) <= 1) return; // always keep at least one
  await db.budgetChanges.delete(id);
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

/** Reuse the user's existing spelling if this merchant (case-insensitively) is already known. */
async function canonicalMerchant(name: string, db: WeeklyDB): Promise<string> {
  const cleaned = cleanText(name);
  const key = normalizeName(cleaned);
  const match = await db.expenses.filter((e) => normalizeName(e.merchantName) === key).first();
  return match?.merchantName ?? cleaned;
}

export async function addExpense(input: ExpenseWrite, db: WeeklyDB = defaultDb): Promise<Expense> {
  const ts = nowIso();
  const expense: Expense = {
    id: newId(),
    merchantName: await canonicalMerchant(input.merchantName, db),
    amountCents: input.amountCents,
    type: input.type,
    categoryId: input.categoryId,
    date: input.date,
    createdAt: ts,
    updatedAt: ts,
  };
  const note = input.note ? cleanText(input.note, MAX_NOTE) : '';
  if (note) expense.note = note;
  if (input.templateId) expense.templateId = input.templateId;

  await db.transaction('rw', [db.expenses, db.templates], async () => {
    await db.expenses.add(expense);
    if (input.templateId) {
      const t = await db.templates.get(input.templateId);
      if (t) await db.templates.update(t.id, { usageCount: t.usageCount + 1, lastUsedAt: ts });
    }
  });
  return expense;
}

export async function updateExpense(id: string, input: ExpenseWrite, db: WeeklyDB = defaultDb): Promise<void> {
  const existing = await db.expenses.get(id);
  if (!existing) return;
  const next: Expense = {
    ...existing,
    merchantName: await canonicalMerchant(input.merchantName, db),
    amountCents: input.amountCents,
    type: input.type,
    categoryId: input.categoryId,
    date: input.date,
    updatedAt: nowIso(),
  };
  const note = input.note ? cleanText(input.note, MAX_NOTE) : '';
  if (note) next.note = note;
  else delete next.note;
  // Editing a purchase never touches the template it came from.
  await db.expenses.put(next);
}

export async function deleteExpense(id: string, db: WeeklyDB = defaultDb): Promise<Expense | undefined> {
  const existing = await db.expenses.get(id);
  if (existing) await db.expenses.delete(id);
  return existing;
}

/** Put back an expense exactly as it was (used by Undo). */
export async function restoreExpense(expense: Expense, db: WeeklyDB = defaultDb) {
  await db.expenses.put(expense);
}

/** Rename a merchant everywhere. If `to` matches another merchant, the two merge. Returns rows changed. */
export async function renameMerchant(from: string, to: string, db: WeeklyDB = defaultDb): Promise<number> {
  const fromKey = normalizeName(from);
  const target = cleanText(to);
  if (!target) return 0;
  const targetKey = normalizeName(target);
  return db.transaction('rw', [db.expenses, db.templates], async () => {
    // If merging into an existing merchant, adopt that merchant's spelling.
    const existing = await db.expenses.filter((e) => normalizeName(e.merchantName) === targetKey && targetKey !== fromKey).first();
    const finalName = existing?.merchantName ?? target;
    const rows = await db.expenses.filter((e) => normalizeName(e.merchantName) === fromKey).toArray();
    const ts = nowIso();
    await db.expenses.bulkPut(rows.map((e) => ({ ...e, merchantName: finalName, updatedAt: ts })));
    const tpls = await db.templates.filter((t) => normalizeName(t.merchantName) === fromKey).toArray();
    await db.templates.bulkPut(tpls.map((t) => ({ ...t, merchantName: finalName })));
    return rows.length + tpls.length;
  });
}

// ---------- categories ----------

export async function addCategory(name: string, db: WeeklyDB = defaultDb): Promise<Category | null> {
  const cleaned = cleanText(name, 40);
  if (!cleaned) return null;
  const all = await db.categories.toArray();
  if (all.some((c) => normalizeName(c.name) === normalizeName(cleaned))) return null;
  const cat: Category = { id: newId(), name: cleaned, sortOrder: Math.max(-1, ...all.map((c) => c.sortOrder)) + 1 };
  await db.categories.add(cat);
  return cat;
}

export async function renameCategory(id: string, name: string, db: WeeklyDB = defaultDb): Promise<boolean> {
  const cleaned = cleanText(name, 40);
  if (!cleaned) return false;
  const all = await db.categories.toArray();
  if (all.some((c) => c.id !== id && normalizeName(c.name) === normalizeName(cleaned))) return false;
  await db.categories.update(id, { name: cleaned });
  return true;
}

/** Delete a category, moving its transactions and shortcuts to `reassignToId`. */
export async function deleteCategory(id: string, reassignToId: string, db: WeeklyDB = defaultDb) {
  if (id === reassignToId) return;
  await db.transaction('rw', [db.categories, db.expenses, db.templates], async () => {
    const exps = await db.expenses.where('categoryId').equals(id).toArray();
    const ts = nowIso();
    await db.expenses.bulkPut(exps.map((e) => ({ ...e, categoryId: reassignToId, updatedAt: ts })));
    const tpls = await db.templates.filter((t) => t.categoryId === id).toArray();
    await db.templates.bulkPut(tpls.map((t) => ({ ...t, categoryId: reassignToId })));
    await db.categories.delete(id);
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

export async function addTemplate(input: TemplateWrite, db: WeeklyDB = defaultDb): Promise<PurchaseTemplate> {
  const t: PurchaseTemplate = {
    id: newId(),
    merchantName: await canonicalMerchant(input.merchantName, db),
    label: cleanText(input.label) || cleanText(input.merchantName),
    kind: input.kind,
    amountCents: input.kind === 'fixed' ? input.amountCents : null,
    categoryId: input.categoryId,
    usageCount: 0,
  };
  await db.templates.add(t);
  return t;
}

export async function updateTemplate(id: string, input: TemplateWrite, db: WeeklyDB = defaultDb) {
  await db.templates.update(id, {
    merchantName: cleanText(input.merchantName),
    label: cleanText(input.label) || cleanText(input.merchantName),
    kind: input.kind,
    amountCents: input.kind === 'fixed' ? input.amountCents : null,
    categoryId: input.categoryId,
  });
}

export async function deleteTemplate(id: string, db: WeeklyDB = defaultDb) {
  await db.templates.delete(id);
  // Past transactions keep their data; only the back-reference is dropped.
  const linked = await db.expenses.filter((e) => e.templateId === id).toArray();
  if (linked.length) await db.expenses.bulkPut(linked.map((e) => { const { templateId: _t, ...rest } = e; return rest; }));
}

// ---------- reset ----------

export async function clearAllData(db: WeeklyDB = defaultDb) {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

export type { BudgetChange, BudgetSettings };
