import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../app/AuthProvider';
import { useData, useToday } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { deleteBudgetChange, setBudgetChange, updateSettings, updateStartAndOpening } from '../../db/repo';
import { addWeeks, formatDateLong, formatWeekRange, isValidISODate, isValidTimeZone, listTimeZones, weekStartOf, maxDate } from '../../lib/dates';
import { centsToInput, formatCents, parseDollars } from '../../lib/money';
import { getThemePref, setThemePref, type ThemePref } from '../../lib/theme';
import { baseAllowanceForWeek } from '../budget/calc';
import { CategoriesSection } from './CategoriesSection';
import { DataSection } from './DataSection';
import { MerchantsSection } from './MerchantsSection';
import { TemplatesSection } from './TemplatesSection';

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-h`}>
      <div className="settings-section__head">
        <h2 id={`${id}-h`} className="h2">{title}</h2>
        {intro && <p className="hint">{intro}</p>}
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50);
  }, [hash]);

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1 className="h1">Settings</h1>
        </div>
      </header>
      <BudgetSection />
      <StartSection />
      <TimeZoneSection />
      <TemplatesSection />
      <CategoriesSection />
      <MerchantsSection />
      <DataSection />
      <AppearanceSection />
      <AccountSection />
    </div>
  );
}

function AccountSection() {
  const { state, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const email = state.status === 'authenticated' ? state.user.email : '';

  return (
    <Section id="account" title="Account">
      <p className="hint">Signed in as {email}.</p>
      <div>
        <button
          type="button"
          className="btn"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            await logout();
          }}
        >
          Sign out
        </button>
      </div>
    </Section>
  );
}

function BudgetSection() {
  const data = useData();
  const toast = useToast();
  const today = useToday(data.settings.timeZone);
  const currentWeek = weekStartOf(today);
  const currentBase = baseAllowanceForWeek(maxDate(currentWeek, data.settings.firstWeekStart), data.budgetChanges);
  const [amount, setAmount] = useState(centsToInput(currentBase));
  const [when, setWhen] = useState<'next' | 'current'>('next');
  const [error, setError] = useState('');

  const nextWeek = maxDate(addWeeks(currentWeek, 1), data.settings.firstWeekStart);
  const thisWeek = maxDate(currentWeek, data.settings.firstWeekStart);
  const effective = when === 'next' ? nextWeek : thisWeek;
  const history = [...data.budgetChanges].sort((a, b) => b.effectiveWeekStart.localeCompare(a.effectiveWeekStart));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const p = parseDollars(amount, { allowZero: true });
    if (!p.ok) return setError(p.error.replace('greater than $0.00', 'a valid amount'));
    setError('');
    await setBudgetChange(effective, p.cents);
    toast.show(`Weekly budget set to ${formatCents(p.cents)} from ${formatDateLong(effective)}.`);
  }

  return (
    <Section id="budget" title="Weekly budget" intro="Changes apply from a Monday you choose. Earlier weeks keep the amount they had.">
      <form onSubmit={save} className="stack" noValidate>
        <div className="field">
          <label className="label" htmlFor="s-base">Weekly allowance</label>
          <div className={`money-input${error ? ' is-invalid' : ''}`}>
            <span aria-hidden>$</span>
            <input id="s-base" className="input input--money" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Boolean(error) || undefined} />
          </div>
          {error ? <p className="error" role="alert">{error}</p> : <p className="hint">Currently {formatCents(currentBase)} this week.</p>}
        </div>
        <fieldset className="field">
          <legend className="label">Takes effect</legend>
          <label className="radio"><input type="radio" name="when" checked={when === 'next'} onChange={() => setWhen('next')} /> Next Monday — {formatDateLong(nextWeek)} <span className="dim">(recommended)</span></label>
          <label className="radio"><input type="radio" name="when" checked={when === 'current'} onChange={() => setWhen('current')} /> This week — {formatWeekRange(thisWeek)} <span className="dim">(changes the current week’s remaining amount)</span></label>
        </fieldset>
        <div><button type="submit" className="btn btn--primary">Save budget</button></div>
      </form>

      <h3 className="h3">Budget history</h3>
      <ul className="rows">
        {history.map((c) => (
          <li key={c.id} className="rows__item">
            <span>From <strong>{formatDateLong(c.effectiveWeekStart)}</strong></span>
            <span className="num">{formatCents(c.baseAllowanceCents)}/week</span>
            {history.length > 1 && (
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  try {
                    await deleteBudgetChange(c.id);
                  } catch {
                    toast.show('Could not remove that budget entry.', { tone: 'error' });
                  }
                }}
                aria-label={`Remove budget change from ${c.effectiveWeekStart}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StartSection() {
  const data = useData();
  const toast = useToast();
  const { settings } = data;
  const [start, setStart] = useState(settings.firstWeekStart);
  const [opening, setOpening] = useState(centsToInput(settings.openingCarryoverCents));
  const [error, setError] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  const parsedOpen = parseDollars(opening || '0', { allowNegative: true, allowZero: true });
  const monday = isValidISODate(start) ? weekStartOf(start) : null;
  const changed = monday !== settings.firstWeekStart || (parsedOpen.ok && parsedOpen.cents !== settings.openingCarryoverCents);
  const excluded = useMemo(() => (monday ? data.expenses.filter((e) => e.date < monday).length : 0), [data.expenses, monday]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!monday) errs.start = 'Choose a valid date.';
    if (!parsedOpen.ok) errs.opening = parsedOpen.error;
    setError(errs);
    return Object.keys(errs).length === 0;
  }

  return (
    <Section id="start" title="Start date & opening balance" intro="The first tracked week begins on a Monday. Nothing before it is invented.">
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); if (validate() && changed) setConfirm(true); }}>
        <div className="field">
          <label className="label" htmlFor="s-start">Tracking start date</label>
          <input id="s-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          <p className={error.start ? 'error' : 'hint'}>{error.start || (monday ? `First tracked week: ${formatWeekRange(monday)}` : '')}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="s-open">Opening carryover</label>
          <div className={`money-input${error.opening ? ' is-invalid' : ''}`}>
            <span aria-hidden>$</span>
            <input id="s-open" className="input input--money" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </div>
          <p className={error.opening ? 'error' : 'hint'}>{error.opening || 'Positive if you start ahead, negative (−) if you start behind.'}</p>
        </div>
        <p className="callout callout--warn">Changing these recomputes the balance of <strong>every week</strong> from the first one forward. Your transactions are not touched.</p>
        {excluded > 0 && <p className="callout callout--warn">{excluded} {excluded === 1 ? 'transaction is' : 'transactions are'} dated before this start and won’t count toward any week (they stay in your ledger).</p>}
        <div><button type="submit" className="btn btn--primary" disabled={!changed}>Save changes</button></div>
      </form>
      <ConfirmDialog
        open={confirm}
        title="Recompute all weeks?"
        confirmLabel="Save and recompute"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (!monday || !parsedOpen.ok) return;
          await updateStartAndOpening({ firstWeekStart: monday, openingCarryoverCents: parsedOpen.cents });
          setConfirm(false);
          toast.show('Start date and opening balance updated. Every week has been recalculated.');
        }}
      >
        <p>Every weekly balance and carryover from {monday ? formatDateLong(monday) : 'the start'} forward will be recalculated using the new values.</p>
      </ConfirmDialog>
    </Section>
  );
}

function TimeZoneSection() {
  const { settings } = useData();
  const toast = useToast();
  const zones = useMemo(() => {
    const all = listTimeZones();
    return all.includes(settings.timeZone) ? all : [settings.timeZone, ...all];
  }, [settings.timeZone]);
  const [zone, setZone] = useState(settings.timeZone);
  const [confirm, setConfirm] = useState(false);

  return (
    <Section id="timezone" title="Time zone" intro="Decides when “today” starts and when a new week begins.">
      <div className="field">
        <label className="label" htmlFor="s-tz">Time zone</label>
        <select id="s-tz" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
        <p className="hint">Each transaction stores a calendar date, so changing your time zone never moves existing purchases between weeks — only what counts as “today” changes.</p>
      </div>
      <div><button type="button" className="btn" disabled={zone === settings.timeZone || !isValidTimeZone(zone)} onClick={() => setConfirm(true)}>Change time zone</button></div>
      <ConfirmDialog open={confirm} title="Change time zone?" confirmLabel="Change" onCancel={() => setConfirm(false)} onConfirm={async () => { await updateSettings({ timeZone: zone }); setConfirm(false); toast.show(`Time zone set to ${zone.replace(/_/g, ' ')}.`); }}>
        <p>“Today” and the current week will follow {zone.replace(/_/g, ' ')} from now on. Existing transactions keep their dates.</p>
      </ConfirmDialog>
    </Section>
  );
}

function AppearanceSection() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  return (
    <Section id="appearance" title="Appearance">
      <fieldset className="field">
        <legend className="label">Theme</legend>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <label key={t} className={`seg__opt${pref === t ? ' is-on' : ''}`}>
              <input type="radio" name="theme" checked={pref === t} onChange={() => { setPref(t); setThemePref(t); }} />
              {t[0]!.toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
}
