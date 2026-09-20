import { Pencil, Trash2 } from 'lucide-react';
import type { Expense } from '../db/types';
import { formatCents } from '../lib/money';
import { formatDateShort, formatWeekdayShort } from '../lib/dates';

type Props = {
  expense: Expense;
  categoryName: string;
  yearOf?: number;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
};

export function ExpenseRow({ expense: e, categoryName, yearOf, onEdit, onDelete }: Props) {
  const refund = e.type === 'refund';
  return (
    <li className="tx">
      <div className="tx__date">
        <span className="tx__dow">{formatWeekdayShort(e.date)}</span>
        <span>{formatDateShort(e.date, yearOf)}</span>
      </div>
      <div className="tx__main">
        <span className="tx__merchant">{e.merchantName}</span>
        <span className="tx__meta">
          {categoryName}
          {refund && <span className="tag">Refund</span>}
          {e.note && <span className="tx__note"> · {e.note}</span>}
        </span>
      </div>
      <div className={`tx__amount num${refund ? ' is-credit' : ''}`}>
        {refund ? '+' : ''}
        {formatCents(e.amountCents)}
        {refund && <span className="sr-only"> refund</span>}
      </div>
      <div className="tx__actions">
        <button type="button" className="icon-btn" onClick={() => onEdit(e)} aria-label={`Edit ${e.merchantName} ${formatCents(e.amountCents)} on ${e.date}`}>
          <Pencil size={16} aria-hidden />
        </button>
        <button type="button" className="icon-btn icon-btn--danger" onClick={() => onDelete(e)} aria-label={`Delete ${e.merchantName} ${formatCents(e.amountCents)} on ${e.date}`}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
    </li>
  );
}
