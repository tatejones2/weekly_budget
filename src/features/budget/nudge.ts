import type { AppData } from '../../db/types';

/** A gentle reminder that data lives only in this browser. Returns null when no nudge is warranted. */
export function downloadBackupNudge(data: AppData, now = Date.now()): string | null {
  if (data.expenses.length < 15) return null;
  const last = data.settings.lastBackupAt ? Date.parse(data.settings.lastBackupAt) : NaN;
  const days = Number.isNaN(last) ? Infinity : (now - last) / 86_400_000;
  if (days < 30) return null;
  return Number.isNaN(last)
    ? 'Your data lives only in this browser and hasn’t been backed up yet.'
    : `It’s been ${Math.floor(days)} days since your last backup.`;
}
