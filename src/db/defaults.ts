import type { Category } from './types';

export const STARTER_CATEGORIES: Category[] = [
  { id: 'cat-dining', name: 'Dining', sortOrder: 0 },
  { id: 'cat-groceries', name: 'Groceries', sortOrder: 1 },
  { id: 'cat-transport', name: 'Gas / Transportation', sortOrder: 2 },
  { id: 'cat-shopping', name: 'Shopping', sortOrder: 3 },
  { id: 'cat-entertainment', name: 'Entertainment', sortOrder: 4 },
  { id: 'cat-bills', name: 'Bills', sortOrder: 5 },
  { id: 'cat-other', name: 'Other', sortOrder: 6 },
];

export const DEFAULT_CATEGORY_ID = 'cat-other';
