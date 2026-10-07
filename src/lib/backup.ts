import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  type AppData,
  type BackupFile,
  type BudgetChange,
  type Category,
  type Expense,
  type PurchaseTemplate,
} from '../db/types';
import { isValidISODate, isValidTimeZone, weekdayIndex } from './dates';
import { isValidCents } from './money';

/**
 * Pure backup-file logic — no Dexie, no browser APIs, no Node APIs. Safe to
 * import from the Vite client build and from the Node server (via tsx)
 * unchanged. Dexie-coupled read/write (`readAppData`/`restoreBackup` in the
 * old `db/backup.ts`) live in `server/repo.ts` now; the browser-only
 * download trigger lives in `lib/download.ts`.
 */

export function buildBackup(data: AppData, exportedAt = new Date().toISOString()): BackupFile {
  const { lastBackupAt: _l, createdAt: _c, ...settings } = data.settings;
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    settings,
    budgetChanges: data.budgetChanges,
    categories: data.categories,
    templates: data.templates,
    expenses: data.expenses,
  };
}

export type BackupResult = { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; errors: string[] };

export type BackupSummary = {
  expenses: number;
  categories: number;
  templates: number;
  budgetChanges: number;
  firstWeekStart: string;
  exportedAt: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

/** Strictly validate an untrusted parsed-JSON value. Nothing is written here. */
export function validateBackup(raw: unknown): BackupResult {
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 12) errors.push(m);
  };

  if (!isObj(raw)) return { ok: false, errors: ['This file is not a Weekly Budget backup.'] };
  if (raw.app !== BACKUP_APP_ID) return { ok: false, errors: ['This file is not a Weekly Budget backup.'] };
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
    return { ok: false, errors: ['Backup is missing a schema version.'] };
  }
  if (raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, errors: [`This backup is from a newer version of the app (schema ${raw.schemaVersion}). Update the app and try again.`] };
  }

  // settings
  const s = raw.settings;
  if (!isObj(s)) err('Settings are missing.');
  else {
    if (!isValidISODate(s.firstWeekStart) || weekdayIndex(s.firstWeekStart) !== 0) err('Settings: first week start must be a Monday date.');
    if (!isValidCents(s.openingCarryoverCents)) err('Settings: opening carryover is invalid.');
    if (!isStr(s.timeZone) || !isValidTimeZone(s.timeZone)) err('Settings: time zone is invalid.');
    if (s.currency !== 'USD') err('Settings: only USD is supported.');
  }

  // categories
  const categories: Category[] = [];
  const catIds = new Set<string>();
  if (!Array.isArray(raw.categories)) err('Categories are missing.');
  else
    raw.categories.forEach((c, i) => {
      if (!isObj(c) || !isNonEmptyStr(c.id) || !isNonEmptyStr(c.name) || typeof c.sortOrder !== 'number') return err(`Category #${i + 1} is malformed.`);
      if (catIds.has(c.id)) return err(`Duplicate category id "${c.id}".`);
      catIds.add(c.id);
      categories.push({ id: c.id, name: c.name, sortOrder: c.sortOrder });
    });
  if (Array.isArray(raw.categories) && categories.length === 0) err('At least one category is required.');

  // budget changes
  const budgetChanges: BudgetChange[] = [];
  const bcIds = new Set<string>();
  if (!Array.isArray(raw.budgetChanges)) err('Budget history is missing.');
  else {
    raw.budgetChanges.forEach((c, i) => {
      if (!isObj(c) || !isNonEmptyStr(c.id)) return err(`Budget change #${i + 1} is malformed.`);
      if (!isValidISODate(c.effectiveWeekStart) || weekdayIndex(c.effectiveWeekStart) !== 0) return err(`Budget change #${i + 1}: effective date must be a Monday.`);
      if (!isValidCents(c.baseAllowanceCents, { min: 0 })) return err(`Budget change #${i + 1}: allowance is invalid.`);
      if (bcIds.has(c.id)) return err(`Duplicate budget change id "${c.id}".`);
      bcIds.add(c.id);
      budgetChanges.push({ id: c.id, effectiveWeekStart: c.effectiveWeekStart, baseAllowanceCents: c.baseAllowanceCents });
    });
    if (budgetChanges.length === 0) err('At least one budget entry is required.');
  }

  // templates
  const templates: PurchaseTemplate[] = [];
  const tplIds = new Set<string>();
  if (!Array.isArray(raw.templates)) err('Shortcuts are missing.');
  else
    raw.templates.forEach((t, i) => {
      if (!isObj(t) || !isNonEmptyStr(t.id) || !isNonEmptyStr(t.merchantName) || !isStr(t.label)) return err(`Shortcut #${i + 1} is malformed.`);
      if (t.kind !== 'fixed' && t.kind !== 'variable') return err(`Shortcut #${i + 1}: kind must be fixed or variable.`);
      if (t.kind === 'fixed' ? !isValidCents(t.amountCents, { min: 1 }) : t.amountCents !== null) return err(`Shortcut #${i + 1}: amount does not match its kind.`);
      if (!isStr(t.categoryId) || !catIds.has(t.categoryId)) return err(`Shortcut #${i + 1} uses an unknown category.`);
      if (tplIds.has(t.id)) return err(`Duplicate shortcut id "${t.id}".`);
      tplIds.add(t.id);
      templates.push({
        id: t.id,
        merchantName: t.merchantName,
        label: t.label,
        kind: t.kind,
        amountCents: t.kind === 'fixed' ? (t.amountCents as number) : null,
        categoryId: t.categoryId,
        usageCount: typeof t.usageCount === 'number' && t.usageCount >= 0 ? Math.floor(t.usageCount) : 0,
        ...(isStr(t.lastUsedAt) ? { lastUsedAt: t.lastUsedAt } : {}),
      });
    });

  // expenses
  const expenses: Expense[] = [];
  const expIds = new Set<string>();
  if (!Array.isArray(raw.expenses)) err('Transactions are missing.');
  else
    raw.expenses.forEach((e, i) => {
      const n = `Transaction #${i + 1}`;
      if (!isObj(e) || !isNonEmptyStr(e.id) || !isNonEmptyStr(e.merchantName)) return err(`${n} is malformed.`);
      if (!isValidCents(e.amountCents, { min: 1 })) return err(`${n}: amount must be a positive whole number of cents.`);
      if (!isValidISODate(e.date)) return err(`${n}: date is invalid.`);
      if (e.type !== undefined && e.type !== 'expense' && e.type !== 'refund') return err(`${n}: type is invalid.`);
      if (!isStr(e.categoryId) || !catIds.has(e.categoryId)) return err(`${n} uses an unknown category.`);
      if (expIds.has(e.id)) return err(`Duplicate transaction id "${e.id}".`);
      expIds.add(e.id);
      const ts = new Date().toISOString();
      expenses.push({
        id: e.id,
        merchantName: e.merchantName,
        amountCents: e.amountCents,
        type: e.type === 'refund' ? 'refund' : 'expense',
        categoryId: e.categoryId,
        date: e.date,
        ...(isStr(e.note) && e.note ? { note: e.note } : {}),
        ...(isStr(e.templateId) && tplIds.has(e.templateId) ? { templateId: e.templateId } : {}),
        createdAt: isStr(e.createdAt) ? e.createdAt : ts,
        updatedAt: isStr(e.updatedAt) ? e.updatedAt : ts,
      });
    });

  if (errors.length) return { ok: false, errors };

  const st = s as Record<string, unknown>;
  const backup: BackupFile = {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '',
    settings: {
      firstWeekStart: st.firstWeekStart as string,
      openingCarryoverCents: st.openingCarryoverCents as number,
      timeZone: st.timeZone as string,
      currency: 'USD',
    },
    budgetChanges,
    categories,
    templates,
    expenses,
  };
  return {
    ok: true,
    backup,
    summary: {
      expenses: expenses.length,
      categories: categories.length,
      templates: templates.length,
      budgetChanges: budgetChanges.length,
      firstWeekStart: backup.settings.firstWeekStart,
      exportedAt: backup.exportedAt,
    },
  };
}

export function parseBackupText(text: string): BackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['That file is not valid JSON.'] };
  }
  return validateBackup(raw);
}
