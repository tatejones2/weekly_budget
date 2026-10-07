import { request, ApiError } from '../api/client';
import { notifyDataChanged } from '../app/dataBus';
import type { BackupFile, BudgetChange, Category, Expense, PurchaseTemplate } from './types';

/**
 * API-backed replacement for the old Dexie gateway. Same exported function
 * names/signatures as before (minus the test-only `db` param, since there's
 * no local handle to inject anymore — see `server/repo.test.ts` for the
 * equivalent server-side behavior tests) — every one of the ~10 feature
 * files that calls these needed zero changes. Every successful write calls
 * `notifyDataChanged()`, which is what makes every screen refresh after any
 * edit, the same way Dexie's live queries did.
 */

// ---------- settings / onboarding ----------

export async function completeOnboarding(input: { baseAllowanceCents: number; firstWeekStart: string; openingCarryoverCents: number; timeZone: string }) {
  await request('/api/onboarding', { method: 'POST', body: input });
  notifyDataChanged();
}

export async function updateSettings(patch: { timeZone?: string; lastBackupAt?: string }) {
  await request('/api/settings', { method: 'PATCH', body: patch });
  notifyDataChanged();
}

export async function updateStartAndOpening(input: { firstWeekStart: string; openingCarryoverCents: number }) {
  await request('/api/settings/start', { method: 'PUT', body: input });
  notifyDataChanged();
}

// ---------- budget changes ----------

export async function setBudgetChange(effectiveWeekStart: string, baseAllowanceCents: number) {
  await request<{ budgetChange: BudgetChange }>('/api/budget-changes', { method: 'PUT', body: { effectiveWeekStart, baseAllowanceCents } });
  notifyDataChanged();
}

export async function deleteBudgetChange(id: string) {
  await request(`/api/budget-changes/${id}`, { method: 'DELETE' });
  notifyDataChanged();
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

export async function addExpense(input: ExpenseWrite): Promise<Expense> {
  const { expense } = await request<{ expense: Expense }>('/api/expenses', { method: 'POST', body: input });
  notifyDataChanged();
  return expense;
}

export async function updateExpense(id: string, input: ExpenseWrite): Promise<void> {
  await request(`/api/expenses/${id}`, { method: 'PATCH', body: input });
  notifyDataChanged();
}

export async function deleteExpense(id: string): Promise<Expense | undefined> {
  const { expense } = await request<{ expense: Expense | null }>(`/api/expenses/${id}`, { method: 'DELETE' });
  notifyDataChanged();
  return expense ?? undefined;
}

/** Put back an expense exactly as it was (used by Undo). */
export async function restoreExpense(expense: Expense): Promise<void> {
  await request(`/api/expenses/${expense.id}/restore`, { method: 'POST', body: expense });
  notifyDataChanged();
}

export async function renameMerchant(from: string, to: string): Promise<number> {
  const { changed } = await request<{ changed: number }>('/api/merchants/rename', { method: 'PATCH', body: { from, to } });
  notifyDataChanged();
  return changed;
}

// ---------- categories ----------

export async function addCategory(name: string): Promise<Category | null> {
  try {
    const { category } = await request<{ category: Category }>('/api/categories', { method: 'POST', body: { name } });
    notifyDataChanged();
    return category;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return null;
    throw error;
  }
}

export async function renameCategory(id: string, name: string): Promise<boolean> {
  try {
    await request(`/api/categories/${id}`, { method: 'PATCH', body: { name } });
    notifyDataChanged();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return false;
    throw error;
  }
}

/** Delete a category, moving its transactions and shortcuts to `reassignToId`. */
export async function deleteCategory(id: string, reassignToId: string): Promise<void> {
  await request(`/api/categories/${id}`, { method: 'DELETE', body: { reassignToId } });
  notifyDataChanged();
}

// ---------- templates ----------

export type TemplateWrite = {
  merchantName: string;
  label: string;
  kind: 'fixed' | 'variable';
  amountCents: number | null;
  categoryId: string;
};

export async function addTemplate(input: TemplateWrite): Promise<PurchaseTemplate> {
  const { template } = await request<{ template: PurchaseTemplate }>('/api/templates', { method: 'POST', body: input });
  notifyDataChanged();
  return template;
}

export async function updateTemplate(id: string, input: TemplateWrite): Promise<void> {
  await request(`/api/templates/${id}`, { method: 'PATCH', body: input });
  notifyDataChanged();
}

export async function deleteTemplate(id: string): Promise<void> {
  await request(`/api/templates/${id}`, { method: 'DELETE' });
  notifyDataChanged();
}

// ---------- backup / reset ----------

/** Server re-validates before replacing anything — see server/repo.ts's `restoreBackupData`. */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await request('/api/backup/restore', { method: 'POST', body: backup });
  notifyDataChanged();
}

export async function clearAllData(): Promise<void> {
  await request('/api/data', { method: 'DELETE' });
  notifyDataChanged();
}
