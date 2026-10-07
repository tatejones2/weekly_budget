/** ISO calendar date, `YYYY-MM-DD`, in the user's budgeting time zone. */
export type ISODate = string;

export type ExpenseType = 'expense' | 'refund';

export type Expense = {
  id: string;
  merchantName: string; // display snapshot, preserves the user's spelling
  amountCents: number; // positive integer; a refund is stored positive with type 'refund'
  type?: ExpenseType; // absent means 'expense'
  categoryId: string;
  date: ISODate;
  note?: string;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

export type PurchaseTemplate = {
  id: string;
  merchantName: string;
  label: string;
  kind: 'fixed' | 'variable';
  amountCents: number | null; // required iff fixed
  categoryId: string;
  usageCount: number;
  lastUsedAt?: string;
};

export type BudgetChange = {
  id: string;
  effectiveWeekStart: ISODate; // a Monday
  baseAllowanceCents: number; // nonnegative integer
};

export type BudgetSettings = {
  firstWeekStart: ISODate;
  openingCarryoverCents: number; // signed
  timeZone: string;
  currency: 'USD';
};

/** A user's settings row — one per account, scoped server-side by the session. */
export type StoredSettings = BudgetSettings & {
  lastBackupAt?: string;
  createdAt: string;
};

export type WeekSummary = {
  weekStart: ISODate;
  weekEnd: ISODate;
  baseCents: number;
  carryInCents: number;
  startingAvailableCents: number;
  spentCents: number; // net of refunds
  remainingCents: number;
  carryOutCents: number;
};

export type AppData = {
  settings: StoredSettings;
  budgetChanges: BudgetChange[];
  categories: Category[];
  templates: PurchaseTemplate[];
  expenses: Expense[];
};

export const BACKUP_APP_ID = 'weekly-budget';
export const BACKUP_SCHEMA_VERSION = 1;

export type BackupFile = {
  app: typeof BACKUP_APP_ID;
  schemaVersion: number;
  exportedAt: string;
  settings: BudgetSettings;
  budgetChanges: BudgetChange[];
  categories: Category[];
  templates: PurchaseTemplate[];
  expenses: Expense[];
};
