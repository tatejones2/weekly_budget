import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useToday } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { MerchantCombobox } from '../../components/MerchantCombobox';
import { addExpense, addTemplate, updateExpense } from '../../db/repo';
import type { Expense, PurchaseTemplate } from '../../db/types';
import { addDays, formatDateLong, weekEndOf, weekStartOf } from '../../lib/dates';
import { centsToInput, formatCents, parseDollars } from '../../lib/money';
import { cleanText, normalizeName, validateExpenseInput, MAX_NOTE } from '../../lib/validation';
import { calculateWeekSummary } from '../budget/calc';
import { sortTemplates, templateDefaults, templatesForMerchant } from '../templates/templates';
import { buildMerchants, suggestMerchants, type MerchantStat } from './merchants';
import { DEFAULT_CATEGORY_ID } from '../../db/defaults';

export type FormInit = {
  expense?: Expense; // edit mode
  template?: PurchaseTemplate; // start from a shortcut
  date?: string;
};

type Props = { init: FormInit; onClose: () => void };

type ShortcutChoice = 'none' | 'fixed' | 'variable';

export function ExpenseForm({ init, onClose }: Props) {
  const data = useData();
  const toast = useToast();
  const today = useToday(data.settings.timeZone);
  const editing = init.expense;

  const defaultCategory = data.categories.find((c) => c.id === DEFAULT_CATEGORY_ID)?.id ?? data.categories[data.categories.length - 1]?.id ?? '';
  const tplDefaults = init.template ? templateDefaults(init.template) : undefined;

  const [type, setType] = useState<'expense' | 'refund'>(editing?.type === 'refund' ? 'refund' : 'expense');
  const [merchant, setMerchant] = useState(editing?.merchantName ?? tplDefaults?.merchantName ?? '');
  const [amountText, setAmountText] = useState(editing ? centsToInput(editing.amountCents) : (tplDefaults?.amountText ?? ''));
  const [date, setDate] = useState(editing?.date ?? init.date ?? today);
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? tplDefaults?.categoryId ?? defaultCategory);
  const [categoryTouched, setCategoryTouched] = useState(Boolean(editing || tplDefaults));
  const [note, setNote] = useState(editing?.note ?? '');
  const [templateId, setTemplateId] = useState<string | undefined>(editing?.templateId ?? tplDefaults?.templateId);
  const [shortcut, setShortcut] = useState<ShortcutChoice>('none');
  const [shortcutLabel, setShortcutLabel] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const merchantRef = useRef<HTMLInputElement>(null);

  const merchants = useMemo(() => buildMerchants(data.expenses), [data.expenses]);
  const categoryName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Unknown';
  const suggestions = useMemo(() => suggestMerchants(merchants, merchant), [merchants, merchant]);
  const known = merchants.find((m) => m.key === normalizeName(merchant));
  const merchantTemplates = useMemo(() => templatesForMerchant(data.templates, merchant), [data.templates, merchant]);
  const topTemplates = useMemo(() => sortTemplates(data.templates).slice(0, 6), [data.templates]);

  // A shortcut only stays "linked" while the merchant still matches it.
  const activeTemplate = data.templates.find((t) => t.id === templateId && normalizeName(t.merchantName) === normalizeName(merchant));

  // Suggest the category last used at a known merchant — but never override a choice the user made.
  useEffect(() => {
    if (!categoryTouched && known) setCategoryId(known.lastCategoryId);
  }, [known?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (t: PurchaseTemplate) => {
    const d = templateDefaults(t);
    setMerchant(d.merchantName);
    setAmountText(d.amountText); // '' for variable — never pre-filled from history
    setCategoryId(d.categoryId);
    setCategoryTouched(true);
    setTemplateId(t.id);
    setErrors({});
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const pickMerchant = (m: MerchantStat) => {
    setMerchant(m.name);
    if (!categoryTouched) setCategoryId(m.lastCategoryId);
    setTemplateId(undefined);
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const parsedAmount = parseDollars(amountText);

  async function save(another: boolean) {
    if (savingRef.current) return; // guard fast double-submit
    const amt = parseDollars(amountText);
    const draft = {
      merchantName: cleanText(merchant),
      amountCents: amt.ok ? amt.cents : 0,
      type,
      categoryId,
      date,
      note: note.trim() ? cleanText(note, MAX_NOTE) : undefined,
    };
    const errs = validateExpenseInput(draft, { categoryIds: new Set(data.categories.map((c) => c.id)), firstWeekStart: data.settings.firstWeekStart });
    if (!amt.ok) errs.amount = amt.error;
    if (shortcut === 'fixed' && !amt.ok) errs.shortcut = 'Enter a valid amount to save a fixed shortcut.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = errs.merchant ? merchantRef.current : errs.amount ? amountRef.current : null;
      first?.focus();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      let linkedTemplate = activeTemplate?.id;
      let savedId: string | undefined = editing?.id;
      if (editing) {
        await updateExpense(editing.id, { ...draft, templateId: linkedTemplate });
      } else {
        if (shortcut !== 'none') {
          const t = await addTemplate({
            merchantName: draft.merchantName,
            label: shortcutLabel || draft.merchantName,
            kind: shortcut,
            amountCents: shortcut === 'fixed' ? draft.amountCents : null,
            categoryId: draft.categoryId,
          });
          linkedTemplate = t.id;
        }
        const created = await addExpense({ ...draft, templateId: linkedTemplate });
        savedId = created.id;
      }

      // Confirm the new balance for the week the purchase belongs to.
      const wk = weekStartOf(draft.date);
      const others = data.expenses.filter((e) => e.id !== savedId);
      const after = [...others, { date: draft.date, amountCents: draft.amountCents, type: draft.type }];
      const summary = calculateWeekSummary({
        weekStart: wk,
        firstWeekStart: data.settings.firstWeekStart,
        openingCarryoverCents: data.settings.openingCarryoverCents,
        budgetChanges: data.budgetChanges,
        expenses: after,
      });
      const verb = editing ? 'Updated' : draft.type === 'refund' ? 'Refunded' : 'Saved';
      const where = wk === weekStartOf(today) ? 'this week' : `week of ${formatDateLong(wk).replace(/^\w+, /, '')}`;
      const bal = summary.remainingCents < 0 ? `${formatCents(-summary.remainingCents)} over ${where}` : `${formatCents(summary.remainingCents)} left ${where}`;
      toast.show(`${verb} ${draft.merchantName} ${formatCents(draft.amountCents)} · ${bal}`);

      if (another && !editing) {
        setMerchant('');
        setAmountText('');
        setNote('');
        setTemplateId(undefined);
        setShortcut('none');
        setShortcutLabel('');
        setCategoryId(defaultCategory);
        setCategoryTouched(false);
        setErrors({});
        merchantRef.current?.focus();
      } else {
        onClose();
      }
    } catch {
      toast.show('Could not save. Your data was not changed — please try again.', { tone: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const showShortcutPicker = !editing && !activeTemplate && type === 'expense' && cleanText(merchant).length > 0;
  const repeatHint = showShortcutPicker && known && known.visits >= 2 && merchantTemplates.length === 0;
  const isRefund = type === 'refund';
  const dateWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(date) ? weekStartOf(date) : null;
  const futureDate = dateWeekStart !== null && date > weekEndOf(weekStartOf(today));

  return (
    <form
      className="stack stack--lg"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {!editing && (
        <div className="seg" role="radiogroup" aria-label="Transaction type">
          {(['expense', 'refund'] as const).map((t) => (
            <label key={t} className={`seg__opt${type === t ? ' is-on' : ''}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />
              {t === 'expense' ? 'Expense' : 'Refund'}
            </label>
          ))}
        </div>
      )}
      {editing && isRefund && <p className="hint">This is a refund — it adds money back to the week.</p>}

      {!editing && !activeTemplate && cleanText(merchant) === '' && topTemplates.length > 0 && (
        <fieldset className="field">
          <legend className="label">Shortcuts</legend>
          <div className="chips">
            {topTemplates.map((t) => (
              <button key={t.id} type="button" className="chip" onClick={() => applyTemplate(t)}>
                <span className="chip__name">{t.label}</span>
                <span className="chip__meta">{t.kind === 'fixed' && t.amountCents !== null ? `${formatCents(t.amountCents)} fixed` : 'amount varies'}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="field">
        <label className="label" htmlFor="ef-merchant">
          Place or payee
        </label>
        <MerchantCombobox
          inputRef={merchantRef}
          value={merchant}
          onChange={(v) => {
            setMerchant(v);
            if (errors.merchant) setErrors((e) => ({ ...e, merchant: '' }));
          }}
          onPick={pickMerchant}
          suggestions={suggestions}
          categoryName={categoryName}
          invalid={Boolean(errors.merchant)}
          describedBy={errors.merchant ? 'ef-merchant-err' : undefined}
          autoFocus={!merchant}
        />
        {errors.merchant && (
          <p id="ef-merchant-err" className="error" role="alert">
            {errors.merchant}
          </p>
        )}
        {merchantTemplates.length > 0 && !editing && (
          <div className="chips chips--tight" aria-label={`Shortcuts for ${merchant}`}>
            {merchantTemplates.map((t) => (
              <button key={t.id} type="button" className={`chip${activeTemplate?.id === t.id ? ' is-on' : ''}`} aria-pressed={activeTemplate?.id === t.id} onClick={() => applyTemplate(t)}>
                <span className="chip__name">{t.label}</span>
                <span className="chip__meta">{t.kind === 'fixed' && t.amountCents !== null ? `Fixed ${formatCents(t.amountCents)}` : 'Variable'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="ef-amount">
            Amount
          </label>
          <div className={`money-input${errors.amount ? ' is-invalid' : ''}`}>
            <span aria-hidden>$</span>
            <input
              ref={amountRef}
              id="ef-amount"
              className="input input--money"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountText}
              aria-invalid={Boolean(errors.amount) || undefined}
              aria-describedby="ef-amount-help"
              data-autofocus={merchant ? '' : undefined}
              onChange={(e) => {
                setAmountText(e.target.value);
                if (errors.amount) setErrors((x) => ({ ...x, amount: '' }));
              }}
            />
          </div>
          <p id="ef-amount-help" className={errors.amount ? 'error' : 'hint'} role={errors.amount ? 'alert' : undefined}>
            {errors.amount ||
              (activeTemplate?.kind === 'fixed' && activeTemplate.amountCents !== null
                ? `Fixed shortcut: ${formatCents(activeTemplate.amountCents)}. Changing it here only changes this purchase.`
                : activeTemplate?.kind === 'variable'
                  ? 'Variable shortcut — enter what you actually paid.'
                  : known && !editing
                    ? `Last time: ${formatCents(known.lastAmountCents)}`
                    : isRefund
                      ? 'Amount returned to you.'
                      : ' ')}
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="ef-date">
            Date
          </label>
          <input
            id="ef-date"
            type="date"
            className="input"
            value={date}
            min={data.settings.firstWeekStart}
            aria-invalid={Boolean(errors.date) || undefined}
            aria-describedby="ef-date-help"
            onChange={(e) => {
              setDate(e.target.value);
              if (errors.date) setErrors((x) => ({ ...x, date: '' }));
            }}
          />
          <p id="ef-date-help" className={errors.date ? 'error' : 'hint'} role={errors.date ? 'alert' : undefined}>
            {errors.date ||
              (date === today ? 'Today' : futureDate ? 'Future date — counts toward that week.' : dateWeekStart ? `Counts toward week of ${formatDateLong(dateWeekStart).replace(/^\w+, /, '')}` : ' ')}
          </p>
          <div className="chips chips--tight">
            <button type="button" className="chip chip--sm" onClick={() => setDate(today)}>
              Today
            </button>
            <button type="button" className="chip chip--sm" onClick={() => setDate(addDays(today, -1))}>
              Yesterday
            </button>
          </div>
        </div>
      </div>

      <fieldset className="field">
        <legend className="label">Category</legend>
        <div className="chips" role="radiogroup" aria-label="Category">
          {data.categories.map((c) => (
            <label key={c.id} className={`chip chip--radio${categoryId === c.id ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="category"
                value={c.id}
                checked={categoryId === c.id}
                onChange={() => {
                  setCategoryId(c.id);
                  setCategoryTouched(true);
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
        {errors.category && <p className="error">{errors.category}</p>}
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="ef-note">
          Note <span className="label__opt">optional</span>
        </label>
        <input id="ef-note" className="input" value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} placeholder="What was it for?" />
      </div>

      {showShortcutPicker && (
        <div className="field field--panel">
          <label className="label" htmlFor="ef-shortcut">
            Save as a shortcut
          </label>
          {repeatHint && (
            <p className="hint">
              You’ve logged {known!.name} {known!.visits} times. Save a shortcut to skip retyping?
            </p>
          )}
          <select id="ef-shortcut" className="input" value={shortcut} onChange={(e) => setShortcut(e.target.value as ShortcutChoice)}>
            <option value="none">Don’t save</option>
            <option value="fixed">Save as fixed {parsedAmount.ok ? formatCents(parsedAmount.cents) : '(amount above)'} — same price every time</option>
            <option value="variable">Save as variable amount — I’ll type the price each time</option>
          </select>
          {shortcut !== 'none' && (
            <div className="field">
              <label className="label" htmlFor="ef-shortcut-label">
                Shortcut name
              </label>
              <input id="ef-shortcut-label" className="input" value={shortcutLabel} maxLength={60} placeholder={cleanText(merchant) || 'e.g. Usual order'} onChange={(e) => setShortcutLabel(e.target.value)} />
            </div>
          )}
          {errors.shortcut && <p className="error">{errors.shortcut}</p>}
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {!editing && (
          <button type="button" className="btn" disabled={saving} onClick={() => void save(true)}>
            Save &amp; add another
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {editing ? 'Save changes' : isRefund ? 'Save refund' : 'Save expense'}
        </button>
      </div>
    </form>
  );
}
