import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../db/db';
import { addExpense, addTemplate, clearAllData, completeOnboarding } from '../db/repo';
import { DataProvider, useDataState } from '../app/DataProvider';
import { ToastProvider } from '../app/Toasts';
import { ExpenseForm } from '../features/expenses/ExpenseForm';
import type { PurchaseTemplate } from '../db/types';
import { todayInZone } from '../lib/dates';

const ZONE = 'America/New_York';

function Harness({ template, onClose = () => {} }: { template?: PurchaseTemplate; onClose?: () => void }) {
  const state = useDataState();
  if (state.status !== 'ready') return <p>loading</p>;
  return <ExpenseForm init={{ template }} onClose={onClose} />;
}

const mount = (template?: PurchaseTemplate, onClose?: () => void) =>
  render(
    <ToastProvider>
      <DataProvider>
        <Harness template={template} onClose={onClose} />
      </DataProvider>
    </ToastProvider>,
  );

beforeEach(async () => {
  await clearAllData();
  await completeOnboarding({ baseAllowanceCents: 15000, firstWeekStart: todayInZone(ZONE), openingCarryoverCents: 0, timeZone: ZONE });
});

const amountField = () => screen.getByLabelText('Amount') as HTMLInputElement;

describe('Add expense workflows', () => {
  it('example D: fixed shortcut prefills $15.67; editing this purchase does not change the shortcut', async () => {
    const tpl = await addTemplate({ merchantName: 'Bojangles', label: 'Usual order', kind: 'fixed', amountCents: 1567, categoryId: 'cat-dining' });
    const user = userEvent.setup();
    mount(tpl);
    await screen.findByLabelText('Amount');
    expect(amountField().value).toBe('15.67');
    expect(screen.getByLabelText('Merchant or place')).toHaveValue('Bojangles');
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    await user.clear(amountField());
    await user.type(amountField(), '17.00');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(async () => expect(await db.expenses.count()).toBe(1));
    const [saved] = await db.expenses.toArray();
    expect(saved!.amountCents).toBe(1700);
    expect(saved!.templateId).toBe(tpl.id);
    expect((await db.templates.get(tpl.id))!.amountCents).toBe(1567);
    expect((await db.templates.get(tpl.id))!.usageCount).toBe(1);
  });

  it('example E: variable shortcut leaves the amount blank even after repeated visits', async () => {
    const tpl = await addTemplate({ merchantName: 'Grocery store', label: 'Groceries', kind: 'variable', amountCents: null, categoryId: 'cat-groceries' });
    for (const cents of [8243, 7100, 9999]) {
      await addExpense({ merchantName: 'Grocery store', amountCents: cents, type: 'expense', categoryId: 'cat-groceries', date: todayInZone(ZONE), templateId: tpl.id });
    }
    const user = userEvent.setup();
    mount(tpl);
    await screen.findByLabelText('Amount');
    expect(amountField().value).toBe('');
    expect(screen.getByLabelText('Merchant or place')).toHaveValue('Grocery store');

    // amount is required before save
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Enter an amount.')).toBeInTheDocument();
    expect(await db.expenses.count()).toBe(3);
  });

  it('rejects empty merchant, zero and malformed amounts, and does not write', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Enter a place or payee.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Merchant or place'), 'Cafe');
    await user.type(amountField(), '0');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Amount must be greater than $0.00.')).toBeInTheDocument();
    await user.clear(amountField());
    await user.type(amountField(), '1.234');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Use at most two decimal places.')).toBeInTheDocument();
    expect(await db.expenses.count()).toBe(0);
  });

  it('saves two identical purchases with "Save & add another" (example: two Bojangles visits)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    for (let i = 0; i < 2; i++) {
      await user.type(screen.getByLabelText('Merchant or place'), 'Bojangles');
      await user.type(amountField(), '15.67');
      await user.click(screen.getByRole('button', { name: 'Save & add another' }));
      await waitFor(async () => expect(await db.expenses.count()).toBe(i + 1));
      await waitFor(() => expect(screen.getByLabelText('Merchant or place')).toHaveValue(''));
    }
    const rows = await db.expenses.toArray();
    expect(rows.map((r) => r.amountCents)).toEqual([1567, 1567]);
  });

  it('offers to save a shortcut only when asked, and stores fixed vs variable correctly', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    await user.type(screen.getByLabelText('Merchant or place'), 'Bojangles');
    await user.type(amountField(), '15.67');
    expect(await db.templates.count()).toBe(0);
    await user.selectOptions(screen.getByLabelText('Save as a shortcut'), 'fixed');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(async () => expect(await db.templates.count()).toBe(1));
    const [t] = await db.templates.toArray();
    expect(t).toMatchObject({ merchantName: 'Bojangles', kind: 'fixed', amountCents: 1567 });
  });

  it('suggests the last category for a known merchant but respects a manual choice', async () => {
    await addExpense({ merchantName: 'Shell', amountCents: 4000, type: 'expense', categoryId: 'cat-transport', date: todayInZone(ZONE) });
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    await user.type(screen.getByLabelText('Merchant or place'), 'shell');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Gas / Transportation' })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: 'Shopping' }));
    await user.clear(screen.getByLabelText('Merchant or place'));
    await user.type(screen.getByLabelText('Merchant or place'), 'Shell');
    expect(screen.getByRole('radio', { name: 'Shopping' })).toBeChecked();
  });

  it('blocks dates before the tracking start', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    await user.type(screen.getByLabelText('Merchant or place'), 'Old');
    await user.type(amountField(), '5');
    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2001-01-01');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    const alert = await screen.findAllByRole('alert');
    expect(within(alert[0]!.parentElement!).getByText(/Tracking starts/)).toBeInTheDocument();
    expect(await db.expenses.count()).toBe(0);
  });
});
