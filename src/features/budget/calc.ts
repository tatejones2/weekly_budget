import type { BudgetChange, Expense, ISODate, WeekSummary } from '../../db/types';
import { addWeeks, diffDays, remainingDaysIncludingToday, weekEndOf, weekStartOf, weeksBetween } from '../../lib/dates';

export const DEFAULT_WEEKLY_CENTS = 15000;

/** Signed contribution of a transaction to spending: refunds reduce it. */
export function spendDelta(e: Pick<Expense, 'amountCents' | 'type'>): number {
  return e.type === 'refund' ? -e.amountCents : e.amountCents;
}

export type SummaryInput = {
  firstWeekStart: ISODate;
  openingCarryoverCents: number;
  budgetChanges: BudgetChange[];
  expenses: Pick<Expense, 'date' | 'amountCents' | 'type'>[];
};

/**
 * Base allowance in force for `weekStart`: the latest change whose effective
 * Monday is on or before that week. Weeks earlier than every change fall back
 * to the earliest change, so moving the start date never leaves a gap.
 */
export function baseAllowanceForWeek(weekStart: ISODate, budgetChanges: BudgetChange[]): number {
  if (budgetChanges.length === 0) return DEFAULT_WEEKLY_CENTS;
  const sorted = [...budgetChanges].sort((a, b) => a.effectiveWeekStart.localeCompare(b.effectiveWeekStart));
  let base = sorted[0]!.baseAllowanceCents;
  for (const c of sorted) {
    if (c.effectiveWeekStart <= weekStart) base = c.baseAllowanceCents;
    else break;
  }
  return base;
}

/** Net spending per week (keyed by Monday), refunds subtracted. */
export function spendByWeek(expenses: SummaryInput['expenses']): Map<ISODate, number> {
  const map = new Map<ISODate, number>();
  for (const e of expenses) {
    const w = weekStartOf(e.date);
    map.set(w, (map.get(w) ?? 0) + spendDelta(e));
  }
  return map;
}

/**
 * Sequentially derive every week from the first tracked week through
 * `throughWeekStart` (inclusive), including weeks with no spending. Nothing is
 * cached or persisted: every call reflects the current ledger, so editing or
 * deleting an old transaction automatically changes every later week.
 */
export function calculateWeekSummaries(input: SummaryInput, throughWeekStart: ISODate): WeekSummary[] {
  const { firstWeekStart, openingCarryoverCents, budgetChanges, expenses } = input;
  const count = weeksBetween(firstWeekStart, throughWeekStart) + 1;
  if (count <= 0) return [];
  const spent = spendByWeek(expenses);
  const out: WeekSummary[] = [];
  let carry = openingCarryoverCents;
  for (let i = 0; i < count; i++) {
    const weekStart = addWeeks(firstWeekStart, i);
    const baseCents = baseAllowanceForWeek(weekStart, budgetChanges);
    const startingAvailableCents = baseCents + carry;
    const spentCents = spent.get(weekStart) ?? 0;
    const remainingCents = startingAvailableCents - spentCents;
    out.push({
      weekStart,
      weekEnd: weekEndOf(weekStart),
      baseCents,
      carryInCents: carry,
      startingAvailableCents,
      spentCents,
      remainingCents,
      carryOutCents: remainingCents,
    });
    carry = remainingCents;
  }
  return out;
}

/** Summary for one week. `weekStart` must not precede `firstWeekStart`. */
export function calculateWeekSummary(input: SummaryInput & { weekStart: ISODate }): WeekSummary {
  const list = calculateWeekSummaries(input, input.weekStart);
  const last = list[list.length - 1];
  if (!last) throw new RangeError('weekStart is before the first tracked week');
  return last;
}

export type DailyAllowance = {
  daysRemaining: number;
  /** Per-day limit, rounded DOWN to the cent so following it can never overspend. */
  perDayCents: number;
  /** Cents left over after `perDayCents × daysRemaining` — the last day can take these. */
  leftoverCents: number;
  overspent: boolean;
};

/**
 * Suggested spend per remaining day, counting today. A non-positive balance is
 * shown as $0.00/day (never a negative allowance).
 */
export function dailyAllowance(remainingCents: number, today: ISODate): DailyAllowance {
  const daysRemaining = remainingDaysIncludingToday(today);
  if (remainingCents <= 0) {
    return { daysRemaining, perDayCents: 0, leftoverCents: 0, overspent: remainingCents < 0 };
  }
  const perDayCents = Math.floor(remainingCents / daysRemaining);
  return { daysRemaining, perDayCents, leftoverCents: remainingCents - perDayCents * daysRemaining, overspent: false };
}

export type WeekPhase = 'past' | 'current' | 'future';

export function weekPhase(weekStart: ISODate, today: ISODate): WeekPhase {
  const current = weekStartOf(today);
  return weekStart < current ? 'past' : weekStart > current ? 'future' : 'current';
}

/** Net spending for each day of a week: index 0 = Monday. */
export function spendByDayOfWeek(weekStart: ISODate, expenses: Pick<Expense, 'date' | 'amountCents' | 'type'>[]): number[] {
  const days = new Array<number>(7).fill(0);
  const end = weekEndOf(weekStart);
  for (const e of expenses) {
    if (e.date < weekStart || e.date > end) continue;
    const idx = diffDays(weekStart, e.date);
    days[idx] = (days[idx] ?? 0) + spendDelta(e);
  }
  return days;
}
