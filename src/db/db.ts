import Dexie, { type EntityTable } from 'dexie';
import type { BudgetChange, Category, Expense, PurchaseTemplate, StoredSettings } from './types';

export class WeeklyDB extends Dexie {
  settings!: EntityTable<StoredSettings, 'id'>;
  budgetChanges!: EntityTable<BudgetChange, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  templates!: EntityTable<PurchaseTemplate, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;

  constructor(name = 'weekly-budget') {
    super(name);
    // Add a new `this.version(n).stores({...}).upgrade(...)` block for future schema changes.
    this.version(1).stores({
      settings: 'id',
      budgetChanges: 'id, effectiveWeekStart',
      categories: 'id, sortOrder',
      templates: 'id, merchantName',
      expenses: 'id, date, categoryId',
    });
  }
}

export const db = new WeeklyDB();
