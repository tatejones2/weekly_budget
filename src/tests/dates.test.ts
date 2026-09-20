import {
  addDays,
  isValidISODate,
  msUntilMidnight,
  remainingDaysIncludingToday,
  todayInZone,
  weekEndOf,
  weekStartOf,
  weeksBetween,
} from '../lib/dates';

describe('week assignment (Monday–Sunday)', () => {
  it('assigns Sunday night to the week that is ending', () => {
    expect(weekStartOf('2026-09-20')).toBe('2026-09-14'); // Sunday
  });
  it('assigns Monday morning to the new week', () => {
    expect(weekStartOf('2026-09-21')).toBe('2026-09-21');
  });
  it('handles month and year boundaries', () => {
    expect(weekStartOf('2026-12-31')).toBe('2026-12-28');
    expect(weekEndOf('2026-12-28')).toBe('2027-01-03');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekStartOf('2026-03-01')).toBe('2026-02-23');
  });
  it('handles leap day', () => {
    expect(weekStartOf('2028-02-29')).toBe('2028-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('is unaffected by daylight-saving dates', () => {
    // US spring-forward 2026-03-08 (Sunday), fall-back 2026-11-01 (Sunday)
    expect(weekStartOf('2026-03-08')).toBe('2026-03-02');
    expect(weekStartOf('2026-03-09')).toBe('2026-03-09');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(weeksBetween('2026-03-02', '2026-03-16')).toBe(2);
    expect(weeksBetween('2026-10-26', '2026-11-09')).toBe(2);
  });
  it('validates dates', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('26-01-01')).toBe(false);
    expect(isValidISODate('2026-09-19')).toBe(true);
  });
});

describe('remaining days including today', () => {
  it('counts Thursday through Sunday as 4', () => {
    expect(remainingDaysIncludingToday('2026-09-17')).toBe(4);
  });
  it('is 7 on Monday and 1 on Sunday', () => {
    expect(remainingDaysIncludingToday('2026-09-14')).toBe(7);
    expect(remainingDaysIncludingToday('2026-09-20')).toBe(1);
  });
});

describe('today in a time zone', () => {
  it('follows the configured zone across midnight', () => {
    // 2026-09-21 03:30 UTC is still Sunday evening in New York (23:30 EDT)…
    const t = Date.UTC(2026, 8, 21, 3, 30);
    expect(todayInZone('America/New_York', t)).toBe('2026-09-20');
    // …but already Monday in UTC and in Tokyo.
    expect(todayInZone('UTC', t)).toBe('2026-09-21');
    expect(todayInZone('Asia/Tokyo', t)).toBe('2026-09-21');
  });
  it('handles the DST transition day (23 hours long)', () => {
    // 2026-03-08 06:59 UTC = 01:59 EST; 07:01 UTC = 03:01 EDT (clock jumped)
    expect(todayInZone('America/New_York', Date.UTC(2026, 2, 8, 6, 59))).toBe('2026-03-08');
    expect(todayInZone('America/New_York', Date.UTC(2026, 2, 8, 7, 1))).toBe('2026-03-08');
    // Local midnight of the next day arrives after only 23h of "today" and counts correctly.
    const t = Date.UTC(2026, 2, 9, 3, 59); // 23:59 EDT on the 8th
    expect(todayInZone('America/New_York', t)).toBe('2026-03-08');
    expect(todayInZone('America/New_York', t + 2 * 60_000)).toBe('2026-03-09');
    expect(msUntilMidnight('America/New_York', t)).toBe(60_000);
  });
});
