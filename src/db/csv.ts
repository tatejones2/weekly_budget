import type { Category, Expense } from './types';

/** Escape a CSV cell and defuse spreadsheet formula injection (=, +, -, @ at the start). */
function cell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function expensesToCsv(expenses: Expense[], categories: Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const rows = [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const header = ['Date', 'Merchant', 'Category', 'Type', 'Amount', 'Note'];
  const lines = [header.join(',')];
  for (const e of rows) {
    const signed = e.type === 'refund' ? -e.amountCents : e.amountCents;
    const amount = `${signed < 0 ? '-' : ''}${Math.floor(Math.abs(signed) / 100)}.${String(Math.abs(signed) % 100).padStart(2, '0')}`;
    lines.push(
      [e.date, cell(e.merchantName), cell(names.get(e.categoryId) ?? 'Unknown'), e.type === 'refund' ? 'Refund' : 'Expense', amount, cell(e.note ?? '')].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
