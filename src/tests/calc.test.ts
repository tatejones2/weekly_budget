import { calculateWeekSummaries, calculateWeekSummary, dailyAllowance, baseAllowanceForWeek, spendByDayOfWeek } from '../features/budget/calc';
import type { BudgetChange } from '../db/types';

const W1 = '2026-09-07';
const W2 = '2026-09-14';
const W3 = '2026-09-21';
const W4 = '2026-09-28';

const bc = (effectiveWeekStart: string, baseAllowanceCents: number, id = effectiveWeekStart): BudgetChange => ({ id, effectiveWeekStart, baseAllowanceCents });
const ex = (date: string, amountCents: number, type?: 'refund') => ({ date, amountCents, type });

const base = { firstWeekStart: W1, openingCarryoverCents: 0, budgetChanges: [bc(W1, 15000)] };

describe('carryover (spec §2.2 table)', () => {
  it('rolls positive and negative balances forward', () => {
    const list = calculateWeekSummaries({ ...base, expenses: [ex('2026-09-08', 17000), ex('2026-09-15', 10000)] }, W3);
    expect(list.map((w) => [w.carryInCents, w.startingAvailableCents, w.spentCents, w.carryOutCents])).toEqual([
      [0, 15000, 17000, -2000],
      [-2000, 13000, 10000, 3000],
      [3000, 18000, 0, 18000],
    ]);
  });

  it('never resets to the base allowance on Monday', () => {
    const w = calculateWeekSummary({ ...base, expenses: [ex('2026-09-08', 20000)], weekStart: W2 });
    expect(w.carryInCents).toBe(-5000);
    expect(w.startingAvailableCents).toBe(10000);
  });

  it('a skipped no-spend week still adds the allowance and carries everything', () => {
    const list = calculateWeekSummaries({ ...base, expenses: [ex('2026-09-08', 5000), ex('2026-09-29', 1000)] }, W4);
    expect(list[1]).toMatchObject({ spentCents: 0, startingAvailableCents: 25000, carryOutCents: 25000 }); // G
    expect(list[2]).toMatchObject({ carryInCents: 25000, startingAvailableCents: 40000, carryOutCents: 40000 });
    expect(list[3]).toMatchObject({ carryInCents: 40000, startingAvailableCents: 55000, spentCents: 1000, carryOutCents: 54000 });
  });

  it('week starts with opening carryover, positive or negative', () => {
    const pos = calculateWeekSummary({ ...base, openingCarryoverCents: 2435, expenses: [], weekStart: W1 });
    expect(pos.startingAvailableCents).toBe(17435);
    const neg = calculateWeekSummary({ ...base, openingCarryoverCents: -18000, expenses: [], weekStart: W1 });
    expect(neg.startingAvailableCents).toBe(-3000);
    expect(neg.remainingCents).toBe(-3000);
  });

  it('example A → B: overspend, then underspend', () => {
    const list = calculateWeekSummaries(
      { ...base, expenses: [ex('2026-09-07', 1567), ex('2026-09-08', 6500), ex('2026-09-10', 8000), ex('2026-09-15', 10000)] },
      W2,
    );
    expect(list[0]).toMatchObject({ spentCents: 16067, remainingCents: -1067 });
    expect(list[1]).toMatchObject({ startingAvailableCents: 13933, remainingCents: 3933 });
    const w3 = calculateWeekSummary({ ...base, expenses: [ex('2026-09-07', 1567), ex('2026-09-08', 6500), ex('2026-09-10', 8000), ex('2026-09-15', 10000)], weekStart: W3 });
    expect(w3.startingAvailableCents).toBe(18933);
  });

  it('example F: correcting an old purchase changes every later week by the same amount', () => {
    const before = [ex('2026-09-08', 1800)];
    const after = [ex('2026-09-08', 2800)];
    const a = calculateWeekSummaries({ ...base, expenses: before }, W4);
    const b = calculateWeekSummaries({ ...base, expenses: after }, W4);
    for (let i = 0; i < 4; i++) expect(a[i]!.remainingCents - b[i]!.remainingCents).toBe(1000);
  });

  it('deleting a purchase reverses its effect', () => {
    const withIt = calculateWeekSummary({ ...base, expenses: [ex('2026-09-08', 4000)], weekStart: W3 });
    const without = calculateWeekSummary({ ...base, expenses: [], weekStart: W3 });
    expect(without.remainingCents - withIt.remainingCents).toBe(4000);
  });

  it('refunds add money back to their week', () => {
    const w = calculateWeekSummary({ ...base, expenses: [ex('2026-09-08', 5000), ex('2026-09-09', 1200, 'refund')], weekStart: W1 });
    expect(w.spentCents).toBe(3800);
    expect(w.remainingCents).toBe(11200);
  });

  it('assigns by transaction date across the Sunday/Monday boundary', () => {
    const list = calculateWeekSummaries({ ...base, expenses: [ex('2026-09-13', 1000), ex('2026-09-14', 2000)] }, W2);
    expect(list[0]!.spentCents).toBe(1000);
    expect(list[1]!.spentCents).toBe(2000);
  });

  it('keeps duplicate purchases (same merchant/date/amount)', () => {
    const w = calculateWeekSummary({ ...base, expenses: [ex('2026-09-08', 1567), ex('2026-09-08', 1567)], weekStart: W1 });
    expect(w.spentCents).toBe(3134);
  });

  it('ignores expenses dated before the first tracked week', () => {
    const w = calculateWeekSummary({ ...base, expenses: [ex('2026-08-01', 99999)], weekStart: W2 });
    expect(w.remainingCents).toBe(30000);
  });

  it('is deterministic and integer-only', () => {
    const input = { ...base, expenses: [ex('2026-09-08', 1999), ex('2026-09-09', 2999), ex('2026-09-10', 3)] };
    const a = calculateWeekSummaries(input, W4);
    const b = calculateWeekSummaries(input, W4);
    expect(a).toEqual(b);
    a.forEach((w) => Object.values(w).forEach((v) => typeof v === 'number' && expect(Number.isInteger(v)).toBe(true)));
  });
});

describe('budget changes with effective Mondays (spec §2.4)', () => {
  const changes = [bc(W1, 15000), bc(W3, 20000)];
  it('picks the allowance in force for each week', () => {
    expect(baseAllowanceForWeek(W1, changes)).toBe(15000);
    expect(baseAllowanceForWeek(W2, changes)).toBe(15000);
    expect(baseAllowanceForWeek(W3, changes)).toBe(20000);
    expect(baseAllowanceForWeek(W4, changes)).toBe(20000);
  });
  it('does not rewrite earlier weeks', () => {
    const before = calculateWeekSummaries({ ...base, expenses: [] }, W4).slice(0, 2);
    const after = calculateWeekSummaries({ ...base, budgetChanges: changes, expenses: [] }, W4);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toMatchObject({ baseCents: 20000, startingAvailableCents: 15000 * 2 + 20000 });
  });
  it('falls back to the earliest change when the start date moves earlier', () => {
    expect(baseAllowanceForWeek('2026-08-31', [bc(W1, 12000)])).toBe(12000);
  });
  it('uses $150 when there is no history at all', () => {
    expect(baseAllowanceForWeek(W1, [])).toBe(15000);
  });
});

describe('daily allowance (spec §2.5)', () => {
  it('example C: $88.00 on a Thursday is $22.00/day over 4 days', () => {
    expect(dailyAllowance(8800, '2026-09-17')).toEqual({ daysRemaining: 4, perDayCents: 2200, leftoverCents: 0, overspent: false });
  });
  it('rounds down so following it never overspends', () => {
    const d = dailyAllowance(10000, '2026-09-17'); // $100 / 4 = 25.00
    expect(d.perDayCents).toBe(2500);
    const e = dailyAllowance(10001, '2026-09-17');
    expect(e.perDayCents).toBe(2500);
    expect(e.leftoverCents).toBe(1);
    const f = dailyAllowance(1000, '2026-09-14'); // $10 / 7 = 1.428…
    expect(f.perDayCents).toBe(142);
    expect(f.perDayCents * f.daysRemaining + f.leftoverCents).toBe(1000);
  });
  it('never shows a negative per-day amount', () => {
    expect(dailyAllowance(-1067, '2026-09-17')).toEqual({ daysRemaining: 4, perDayCents: 0, leftoverCents: 0, overspent: true });
    expect(dailyAllowance(0, '2026-09-17').perDayCents).toBe(0);
    expect(dailyAllowance(0, '2026-09-17').overspent).toBe(false);
  });
  it('on Sunday the whole balance is the daily amount', () => {
    expect(dailyAllowance(4321, '2026-09-20').perDayCents).toBe(4321);
  });
  it('updates as purchases change the remaining balance', () => {
    const remaining = (spent: number) => calculateWeekSummary({ ...base, expenses: [ex('2026-09-08', spent)], weekStart: W1 }).remainingCents;
    expect(dailyAllowance(remaining(6200), '2026-09-17').perDayCents).toBe(2200);
    expect(dailyAllowance(remaining(7000), '2026-09-17').perDayCents).toBe(2000);
  });
});

describe('spendByDayOfWeek', () => {
  it('buckets a week Monday→Sunday', () => {
    const days = spendByDayOfWeek(W2, [ex('2026-09-14', 100), ex('2026-09-14', 50), ex('2026-09-20', 700), ex('2026-09-21', 999), ex('2026-09-13', 999)]);
    expect(days).toEqual([150, 0, 0, 0, 0, 0, 700]);
  });
});
