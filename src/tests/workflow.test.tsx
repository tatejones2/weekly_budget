// @vitest-environment jsdom
import type { Server } from 'node:http';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { app } from '../../server/app.ts';
import { pool } from '../../server/db.ts';
import * as repo from '../../server/repo.ts';
import { DataProvider, useDataState } from '../app/DataProvider';
import { ToastProvider } from '../app/Toasts';
import { ExpenseForm } from '../features/expenses/ExpenseForm';
import type { PurchaseTemplate } from '../db/types';
import { todayInZone } from '../lib/dates';

/**
 * True end-to-end integration test: renders real React components
 * (DataProvider, ExpenseForm) against a real in-process Express server and a
 * real Postgres (same DATABASE_URL as server/repo.test.ts), through the
 * actual `fetch`-based api client — not a mock. The only test-only plumbing
 * is a tiny fetch wrapper below that (a) points relative "/api/..." calls at
 * the ephemeral server port, and (b) manually tracks the session cookie,
 * since Node's fetch (unlike a real browser) doesn't persist cookies between
 * calls on its own.
 */

const ZONE = 'America/New_York';
let server: Server;
let originalFetch: typeof fetch;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  let sessionCookie = '';
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' && input.startsWith('/') ? baseUrl + input : input;
    const headers = new Headers(init.headers);
    if (sessionCookie) headers.set('cookie', sessionCookie);
    const response = await originalFetch(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) sessionCookie = setCookie.split(';')[0]!;
    return response;
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

let n = 0;
async function registerAndOnboard() {
  const email = `workflow-${Date.now()}-${n++}@example.com`;
  await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery', name: 'Test' }),
  });
  await fetch('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseAllowanceCents: 15000, firstWeekStart: todayInZone(ZONE), openingCarryoverCents: 0, timeZone: ZONE }),
  });
}

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

const amountField = () => screen.getByLabelText('Amount') as HTMLInputElement;

describe('Add expense workflows (against the real server)', () => {
  beforeEach(async () => {
    await registerAndOnboard();
  });

  it('example D: fixed shortcut prefills $15.67; editing this purchase does not change the shortcut', async () => {
    const data = await (await fetch('/api/data')).json();
    const diningId = data.categories.find((c: any) => c.name === 'Dining').id;
    const tpl = await repo.addTemplate((await (await fetch('/api/auth/me')).json()).user.id, {
      merchantName: 'Bojangles',
      label: 'Usual order',
      kind: 'fixed',
      amountCents: 1567,
      categoryId: diningId,
    });

    const user = userEvent.setup();
    mount(tpl);
    await screen.findByLabelText('Amount');
    expect(amountField().value).toBe('15.67');
    expect(screen.getByLabelText('Merchant or place')).toHaveValue('Bojangles');

    await user.clear(amountField());
    await user.type(amountField(), '17.00');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(async () => {
      const after = await (await fetch('/api/data')).json();
      expect(after.expenses).toHaveLength(1);
    });
    const after = await (await fetch('/api/data')).json();
    expect(after.expenses[0].amountCents).toBe(1700);
    expect(after.expenses[0].templateId).toBe(tpl.id);
    expect(after.templates.find((t: any) => t.id === tpl.id).amountCents).toBe(1567);
  });

  it('example E: variable shortcut leaves the amount blank even after repeated visits, and requires an amount before save', async () => {
    const data = await (await fetch('/api/data')).json();
    const groceriesId = data.categories.find((c: any) => c.name === 'Groceries').id;
    const me = await (await fetch('/api/auth/me')).json();
    const tpl = await repo.addTemplate(me.user.id, { merchantName: 'Grocery store', label: 'Groceries', kind: 'variable', amountCents: null, categoryId: groceriesId });
    for (const cents of [8243, 7100, 9999]) {
      await repo.addExpense(me.user.id, { merchantName: 'Grocery store', amountCents: cents, type: 'expense', categoryId: groceriesId, date: todayInZone(ZONE), templateId: tpl.id });
    }

    const user = userEvent.setup();
    mount(tpl);
    await screen.findByLabelText('Amount');
    expect(amountField().value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Enter an amount.')).toBeInTheDocument();
    const after = await (await fetch('/api/data')).json();
    expect(after.expenses).toHaveLength(3);
  });

  it('saves two identical purchases with "Save & add another" (two Bojangles visits)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Amount');
    for (let i = 0; i < 2; i++) {
      await user.type(screen.getByLabelText('Merchant or place'), 'Bojangles');
      await user.type(amountField(), '15.67');
      await user.click(screen.getByRole('button', { name: 'Save & add another' }));
      await waitFor(async () => {
        const data = await (await fetch('/api/data')).json();
        expect(data.expenses).toHaveLength(i + 1);
      });
      await waitFor(() => expect(screen.getByLabelText('Merchant or place')).toHaveValue(''));
    }
    const data = await (await fetch('/api/data')).json();
    expect(data.expenses.map((e: any) => e.amountCents)).toEqual([1567, 1567]);
  });

  it('rejects empty merchant, zero and malformed amounts, and writes nothing', async () => {
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
    const data = await (await fetch('/api/data')).json();
    expect(data.expenses).toHaveLength(0);
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
    const data = await (await fetch('/api/data')).json();
    expect(data.expenses).toHaveLength(0);
  });
});
