import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../components/Modal';
import { ExpenseForm, type FormInit } from '../features/expenses/ExpenseForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { deleteExpense, restoreExpense } from '../db/repo';
import type { Expense } from '../db/types';
import { formatCents } from '../lib/money';
import { useToast } from './Toasts';

type Api = {
  openAdd: (init?: Omit<FormInit, 'expense'>) => void;
  openEdit: (expense: Expense) => void;
  askDelete: (expense: Expense) => void;
};

const Ctx = createContext<Api>({ openAdd: () => {}, openEdit: () => {}, askDelete: () => {} });
export const useExpenseActions = () => useContext(Ctx);

export function AddExpenseProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<{ init: FormInit; key: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const toast = useToast();

  const openAdd = useCallback((init: Omit<FormInit, 'expense'> = {}) => setForm({ init, key: Date.now() }), []);
  const openEdit = useCallback((expense: Expense) => setForm({ init: { expense }, key: Date.now() }), []);
  const askDelete = useCallback((expense: Expense) => setPendingDelete(expense), []);

  // "n" opens the add form from anywhere the user isn't typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      openAdd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAdd]);

  const api = useMemo(() => ({ openAdd, openEdit, askDelete }), [openAdd, openEdit, askDelete]);
  const close = () => setForm(null);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal open={form !== null} onClose={close} title={form?.init.expense ? 'Edit transaction' : 'Add expense'} initialFocus="[data-autofocus]">
        {form && <ExpenseForm key={form.key} init={form.init} onClose={close} />}
      </Modal>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this transaction?"
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (!target) return;
          const removed = await deleteExpense(target.id);
          if (removed) {
            toast.show(`Deleted ${removed.merchantName} ${formatCents(removed.amountCents)}`, {
              action: {
                label: 'Undo',
                run: async () => {
                  try {
                    await restoreExpense(removed);
                  } catch {
                    toast.show('Could not undo the delete. The transaction is still removed.', { tone: 'error' });
                  }
                },
              },
            });
          }
        }}
      >
        {pendingDelete && (
          <p>
            {pendingDelete.merchantName} · {formatCents(pendingDelete.amountCents)} on {pendingDelete.date} will be removed and every week after it will be recalculated. You can undo right after.
          </p>
        )}
      </ConfirmDialog>
    </Ctx.Provider>
  );
}
