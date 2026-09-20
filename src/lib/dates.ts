import { DateTime } from 'luxon';
import type { ISODate } from '../db/types';

/**
 * Calendar math on `YYYY-MM-DD` strings. Dates are treated as plain calendar
 * days (parsed in UTC), so results never depend on the machine's time zone or
 * on daylight-saving shifts. The time zone only matters for answering
 * "what is today's date?" — see `todayInZone`.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const d = DateTime.fromISO(s, { zone: 'utc' });
  return d.isValid && d.toISODate() === s;
}

function parse(s: ISODate): DateTime {
  return DateTime.fromISO(s, { zone: 'utc' });
}

export function addDays(date: ISODate, days: number): ISODate {
  return parse(date).plus({ days }).toISODate()!;
}

export function addWeeks(date: ISODate, weeks: number): ISODate {
  return addDays(date, weeks * 7);
}

/** Difference `b - a` in whole calendar days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round(parse(b).diff(parse(a), 'days').days);
}

/** Monday of the Monday–Sunday week containing `date`. */
export function weekStartOf(date: ISODate): ISODate {
  const d = parse(date);
  return d.minus({ days: d.weekday - 1 }).toISODate()!; // Luxon: Monday = 1
}

export function weekEndOf(weekStart: ISODate): ISODate {
  return addDays(weekStart, 6);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: ISODate): number {
  return parse(date).weekday - 1;
}

export function weeksBetween(fromWeekStart: ISODate, toWeekStart: ISODate): number {
  return Math.round(diffDays(fromWeekStart, toWeekStart) / 7);
}

/** Current calendar date in the given IANA zone. `now` is injectable for tests. */
export function todayInZone(timeZone: string, now: Date | number = Date.now()): ISODate {
  const dt = DateTime.fromMillis(typeof now === 'number' ? now : now.getTime(), { zone: timeZone });
  return (dt.isValid ? dt : DateTime.fromMillis(+now)).toISODate()!;
}

/** Milliseconds until the next local midnight in `timeZone`. */
export function msUntilMidnight(timeZone: string, now: Date | number = Date.now()): number {
  const ms = typeof now === 'number' ? now : now.getTime();
  const dt = DateTime.fromMillis(ms, { zone: timeZone });
  return Math.max(1000, dt.plus({ days: 1 }).startOf('day').toMillis() - ms);
}

/** Calendar days from `today` through the Sunday of its week, inclusive (1–7). */
export function remainingDaysIncludingToday(today: ISODate): number {
  return 7 - weekdayIndex(today);
}

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function listTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const zones = fn ? fn('timeZone') : [];
    if (zones.length) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    /* fall through */
  }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
}

// ---------- display formatting ----------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** `MON 14 SEP` */
export function formatDayUpper(date: ISODate): string {
  const d = parse(date);
  return `${DAYS[d.weekday - 1]} ${d.day} ${MONTHS[d.month - 1]}`;
}

/** `MON 14 SEP — SUN 20 SEP` (adds the year when it isn't `yearOf`). */
export function formatWeekRange(weekStart: ISODate, yearOf?: number): string {
  const end = weekEndOf(weekStart);
  const showYear = yearOf !== undefined && (parse(weekStart).year !== yearOf || parse(end).year !== yearOf);
  const suffix = showYear ? ` ${parse(end).year}` : '';
  return `${formatDayUpper(weekStart)} — ${formatDayUpper(end)}${suffix}`;
}

/** `Mon, Sep 14, 2026` */
export function formatDateLong(date: ISODate): string {
  return parse(date).setLocale('en-US').toFormat('ccc, LLL d, yyyy');
}

/** `Sep 14` (adds year when different from `yearOf`) */
export function formatDateShort(date: ISODate, yearOf?: number): string {
  const d = parse(date).setLocale('en-US');
  return yearOf !== undefined && d.year !== yearOf ? d.toFormat('LLL d, yyyy') : d.toFormat('LLL d');
}

export function formatWeekdayShort(date: ISODate): string {
  return parse(date).setLocale('en-US').toFormat('ccc');
}

export function formatDateTimeLocal(iso: string, timeZone?: string): string {
  const d = DateTime.fromISO(iso).setLocale('en-US');
  return (timeZone ? d.setZone(timeZone) : d).toFormat("LLL d, yyyy 'at' h:mm a");
}

export function yearOf(date: ISODate): number {
  return parse(date).year;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}
export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}
