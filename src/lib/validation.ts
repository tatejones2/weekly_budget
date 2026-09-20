import { isValidISODate } from './dates';
import { isValidCents } from './money';

export const MAX_TEXT = 120;
export const MAX_NOTE = 500;

export function normalizeName(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanText(s: string, max = MAX_TEXT): string {
  return s.trim().replace(/\s+/g, ' ').slice(0, max);
}

export type ExpenseInput = {
  merchantName: string;
  amountCents: number;
  type: 'expense' | 'refund';
  categoryId: string;
  date: string;
  note?: string;
};

/** Returns a map of field -> error message; empty when valid. */
export function validateExpenseInput(input: ExpenseInput, opts: { categoryIds: Set<string>; firstWeekStart?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!cleanText(input.merchantName)) errors.merchant = 'Enter a place or payee.';
  if (!isValidCents(input.amountCents, { min: 1 })) errors.amount = 'Amount must be greater than $0.00.';
  if (!isValidISODate(input.date)) errors.date = 'Enter a valid date.';
  else if (opts.firstWeekStart && input.date < opts.firstWeekStart) {
    errors.date = `Tracking starts ${opts.firstWeekStart}. Change the start date in Settings to log earlier purchases.`;
  }
  if (!opts.categoryIds.has(input.categoryId)) errors.category = 'Choose a category.';
  return errors;
}
