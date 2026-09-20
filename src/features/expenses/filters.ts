import type { Expense, ISODate } from '../../db/types';
import { addDays, addWeeks, weekEndOf, weekStartOf } from '../../lib/dates';
import { normalizeName } from '../../lib/validation';
import { spendDelta } from '../budget/calc';

export type RangePreset = 'all' | 'this-week' | 'last-week' | 'last-4' | 'last-12' | 'this-month' | 'custom';

export type DateRange = { from?: ISODate; to?: ISODate };

export const PRESET_LABELS: Record<RangePreset, string> = {
  all: 'All time',
  'this-week': 'This week',
  'last-week': 'Last week',
  'last-4': 'Last 4 weeks',
  'last-12': 'Last 12 weeks',
  'this-month': 'This month',
  custom: 'Custom range',
};

export function resolveRange(preset: RangePreset, today: ISODate, custom: DateRange = {}): DateRange {
  const wk = weekStartOf(today);
  switch (preset) {
    case 'all':
      return {};
    case 'this-week':
      return { from: wk, to: weekEndOf(wk) };
    case 'last-week':
      return { from: addWeeks(wk, -1), to: addDays(wk, -1) };
    case 'last-4':
      return { from: addWeeks(wk, -3), to: weekEndOf(wk) };
    case 'last-12':
      return { from: addWeeks(wk, -11), to: weekEndOf(wk) };
    case 'this-month':
      return { from: `${today.slice(0, 7)}-01`, to: lastOfMonth(today) };
    case 'custom':
      return custom;
  }
}

function lastOfMonth(date: ISODate): ISODate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export function inRange(date: ISODate, r: DateRange): boolean {
  return (!r.from || date >= r.from) && (!r.to || date <= r.to);
}

export type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'merchant-asc';

export const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
  'amount-desc': 'Amount: high to low',
  'amount-asc': 'Amount: low to high',
  'merchant-asc': 'Place: A to Z',
};

export type Filters = {
  query: string;
  categoryId: string; // '' = all
  merchant: string; // normalized key, '' = all
  range: DateRange;
};

export function filterExpenses(list: Expense[], f: Filters): Expense[] {
  const q = normalizeName(f.query);
  return list.filter((e) => {
    if (!inRange(e.date, f.range)) return false;
    if (f.categoryId && e.categoryId !== f.categoryId) return false;
    if (f.merchant && normalizeName(e.merchantName) !== f.merchant) return false;
    if (q && !normalizeName(`${e.merchantName} ${e.note ?? ''}`).includes(q)) return false;
    return true;
  });
}

export function sortExpenses(list: Expense[], key: SortKey): Expense[] {
  const byDate = (a: Expense, b: Expense) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
  const arr = [...list];
  switch (key) {
    case 'date-desc':
      return arr.sort((a, b) => byDate(b, a));
    case 'date-asc':
      return arr.sort(byDate);
    case 'amount-desc':
      return arr.sort((a, b) => spendDelta(b) - spendDelta(a) || byDate(b, a));
    case 'amount-asc':
      return arr.sort((a, b) => spendDelta(a) - spendDelta(b) || byDate(b, a));
    case 'merchant-asc':
      return arr.sort((a, b) => a.merchantName.localeCompare(b.merchantName, undefined, { sensitivity: 'base' }) || byDate(b, a));
  }
}

export function netTotal(list: Expense[]): number {
  return list.reduce((sum, e) => sum + spendDelta(e), 0);
}
