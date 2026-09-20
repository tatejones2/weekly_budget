import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useData, useToday } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { buildBackup, downloadFile, parseBackupText, restoreBackup, type BackupSummary } from '../../db/backup';
import { expensesToCsv } from '../../db/csv';
import { clearAllData, updateSettings } from '../../db/repo';
import { formatDateLong, formatDateTimeLocal } from '../../lib/dates';
import type { BackupFile } from '../../db/types';
import { Section } from './SettingsPage';

export function DataSection() {
  const data = useData();
  const toast = useToast();
  const today = useToday(data.settings.timeZone);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ backup: BackupFile; summary: BackupSummary; filename: string } | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);
  const last = data.settings.lastBackupAt;

  async function exportJson() {
    const backup = buildBackup(data);
    downloadFile(`weekly-backup-${today}.json`, JSON.stringify(backup, null, 2), 'application/json');
    await updateSettings({ lastBackupAt: new Date().toISOString() });
    toast.show('Backup downloaded. Keep it somewhere safe.');
  }

  async function onFile(file: File | undefined) {
    setImportErrors([]);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return setImportErrors(['That file is too large to be a Weekly Budget backup.']);
    const result = parseBackupText(await file.text());
    if (!result.ok) return setImportErrors(result.errors);
    setPreview({ backup: result.backup, summary: result.summary, filename: file.name });
  }

  return (
    <Section id="data" title="Your data" intro="Everything is stored in this browser on this device. Nothing is sent anywhere — there is no account and no cloud copy.">
      <div className="callout">
        <strong>Back up regularly.</strong> Clearing site data, using a different browser or device, or a private window will show an empty app. Download a JSON backup to keep a full copy or move to another device.
      </div>
      <p className="hint">Last backup: {last ? formatDateTimeLocal(last, data.settings.timeZone) : 'never'} · {data.expenses.length} transactions</p>

      <div className="row row--wrap">
        <button type="button" className="btn btn--primary" onClick={() => void exportJson()}><Download size={16} aria-hidden /> Download JSON backup</button>
        <button type="button" className="btn" onClick={() => downloadFile(`weekly-transactions-${today}.csv`, expensesToCsv(data.expenses, data.categories), 'text/csv;charset=utf-8')} disabled={data.expenses.length === 0}><Download size={16} aria-hidden /> Export CSV</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} aria-hidden /> Import JSON backup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Choose a backup file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <p className="hint">JSON is a complete backup (settings, budget history, categories, shortcuts, transactions) and can be restored. CSV is a readable list of transactions for spreadsheets — it can’t restore the app.</p>

      {importErrors.length > 0 && (
        <div className="callout callout--bad" role="alert">
          <strong>That file can’t be imported. Your current data was not changed.</strong>
          <ul className="bullets">{importErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className="danger-zone">
        <h3 className="h3">Danger zone</h3>
        <p className="hint">Deletes all transactions, shortcuts, categories and settings from this browser and returns to setup.</p>
        <button type="button" className="btn btn--danger-outline" onClick={() => setClearing(true)}>Clear all data…</button>
      </div>

      <ConfirmDialog
        open={preview !== null}
        title="Replace your data with this backup?"
        confirmLabel="Replace my data"
        danger
        onCancel={() => setPreview(null)}
        onConfirm={async () => {
          if (!preview) return;
          try {
            await restoreBackup(preview.backup);
            toast.show(`Restored ${preview.summary.expenses} transactions.`);
          } catch {
            toast.show('Import failed. Your existing data was not changed.', { tone: 'error' });
          }
          setPreview(null);
        }}
      >
        {preview && (
          <div className="stack">
            <p><strong>{preview.filename}</strong>{preview.summary.exportedAt && <> · exported {formatDateTimeLocal(preview.summary.exportedAt)}</>}</p>
            <ul className="bullets">
              <li>{preview.summary.expenses} transactions</li>
              <li>{preview.summary.templates} shortcuts · {preview.summary.categories} categories</li>
              <li>{preview.summary.budgetChanges} budget entries · tracking from {formatDateLong(preview.summary.firstWeekStart)}</li>
            </ul>
            <p>This <strong>replaces</strong> everything currently in the app ({data.expenses.length} transactions). It can’t be undone — download a backup first if you’re unsure.</p>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={clearing}
        title="Delete all data?"
        confirmLabel="Delete everything"
        danger
        requireText="DELETE"
        onCancel={() => setClearing(false)}
        onConfirm={async () => {
          await clearAllData();
          setClearing(false);
        }}
      >
        <p>This permanently erases all {data.expenses.length} transactions and every setting from this browser. There is no cloud copy to recover from.</p>
      </ConfirmDialog>
    </Section>
  );
}
