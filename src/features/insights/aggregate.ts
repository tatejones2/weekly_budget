import type { Category, Expense, ISODate } from '../../db/types';
import { addDays, diffDays, weekdayIndex } from '../../lib/dates';
import { normalizeName } from '../../lib/validation';
import { spendDelta } from '../budget/calc';

export type CategoryTotal = { id: string; name: string; cents: number; share: number; count: number };

/** Net spend per category (refunds subtract). Categories at or below zero are omitted. */
export function categoryBreakdown(expenses: Expense[], categories: Category[]): CategoryTotal[] {
  const totals = new Map<string, { cents: number; count: number }>();
  for (const e of expenses) {
    const t = totals.get(e.categoryId) ?? { cents: 0, count: 0 };
    t.cents += spendDelta(e);
    t.count += e.type === 'refund' ? 0 : 1;
    totals.set(e.categoryId, t);
  }
  const rows = [...totals.entries()]
    .map(([id, t]) => ({ id, name: categories.find((c) => c.id === id)?.name ?? 'Unknown', cents: t.cents, count: t.count, share: 0 }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const sum = rows.reduce((s, r) => s + r.cents, 0);
  return rows.map((r) => ({ ...r, share: sum > 0 ? r.cents / sum : 0 }));
}

export type MerchantRow = { key: string; name: string; visits: number; totalCents: number; avgCents: number; lastDate: ISODate };

export function merchantBreakdown(expenses: Expense[]): MerchantRow[] {
  const map = new Map<string, MerchantRow & { purchaseCents: number }>();
  for (const e of expenses) {
    const key = normalizeName(e.merchantName);
    const r = map.get(key) ?? { key, name: e.merchantName, visits: 0, totalCents: 0, avgCents: 0, lastDate: e.date, purchaseCents: 0 };
    if (e.type === 'refund') r.totalCents -= e.amountCents;
    else {
      r.visits += 1;
      r.totalCents += e.amountCents;
      r.purchaseCents += e.amountCents;
    }
    if (e.date >= r.lastDate) {
      r.lastDate = e.date;
      r.name = e.merchantName;
    }
    map.set(key, r);
  }
  return [...map.values()]
    .map(({ purchaseCents, ...r }) => ({ ...r, avgCents: r.visits ? Math.round(purchaseCents / r.visits) : 0 }))
    .sort((a, b) => b.totalCents - a.totalCents || b.visits - a.visits);
}

export type WeekdayStat = { index: number; totalCents: number; days: number; avgCents: number };

/** Average net spend for each weekday across the calendar days in [from, to]. Index 0 = Monday. */
export function weekdayPattern(expenses: Expense[], from: ISODate, to: ISODate): WeekdayStat[] {
  const stats: WeekdayStat[] = Array.from({ length: 7 }, (_, index) => ({ index, totalCents: 0, days: 0, avgCents: 0 }));
  const span = diffDays(from, to);
  for (let i = 0; i <= span; i++) stats[weekdayIndex(addDays(from, i))]!.days += 1;
  for (const e of expenses) {
    if (e.date < from || e.date > to) continue;
    stats[weekdayIndex(e.date)]!.totalCents += spendDelta(e);
  }
  for (const s of stats) s.avgCents = s.days ? Math.round(s.totalCents / s.days) : 0;
  return stats;
}

export function largestPurchases(expenses: Expense[], n = 5): Expense[] {
  return expenses
    .filter((e) => e.type !== 'refund')
    .sort((a, b) => b.amountCents - a.amountCents || b.date.localeCompare(a.date))
    .slice(0, n);
}
