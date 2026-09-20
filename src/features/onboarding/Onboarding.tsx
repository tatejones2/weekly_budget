import { useMemo, useState } from 'react';
import { completeOnboarding } from '../../db/repo';
import { detectTimeZone, formatDateLong, formatWeekRange, isValidISODate, listTimeZones, todayInZone, weekStartOf } from '../../lib/dates';
import { centsToInput, formatCents, parseDollars } from '../../lib/money';
import { DEFAULT_WEEKLY_CENTS } from '../budget/calc';

export function Onboarding() {
  const zones = useMemo(() => {
    const detected = detectTimeZone();
    const all = listTimeZones();
    return all.includes(detected) ? all : [detected, ...all];
  }, []);
  const [timeZone, setTimeZone] = useState(detectTimeZone());
  const [base, setBase] = useState(centsToInput(DEFAULT_WEEKLY_CENTS));
  const [start, setStart] = useState(() => todayInZone(detectTimeZone()));
  const [opening, setOpening] = useState('0.00');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const monday = isValidISODate(start) ? weekStartOf(start) : null;
  const baseParsed = parseDollars(base, { allowZero: true });
  const openParsed = parseDollars(opening || '0', { allowNegative: true, allowZero: true });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    if (!baseParsed.ok) errs.base = baseParsed.error.replace('greater than $0.00', 'a valid amount');
    if (!monday) errs.start = 'Choose a valid date.';
    if (!openParsed.ok) errs.opening = openParsed.error;
    setErrors(errs);
    if (Object.keys(errs).length || !baseParsed.ok || !openParsed.ok || !monday) return;
    setBusy(true);
    try {
      await completeOnboarding({ baseAllowanceCents: baseParsed.cents, firstWeekStart: monday, openingCarryoverCents: openParsed.cents, timeZone });
    } catch {
      setErrors({ form: 'Could not save to this browser’s storage. Check that private browsing or storage blocking is off, then try again.' });
      setBusy(false);
    }
  }

  return (
    <div className="onboard">
      <div className="onboard__intro">
        <span className="brand brand--big">
          <span className="brand__mark" aria-hidden />
          <span className="brand__word">WEEKLY</span>
        </span>
        <h1 className="display">
          Spend less than
          <br />
          you planned.
          <br />
          <span className="display__accent">One week at a time.</span>
        </h1>
        <p className="lede">
          A weekly allowance that carries forward. Underspend and next week is bigger; overspend and it’s smaller. Everything stays on this device — no account, no sign-up.
        </p>
      </div>

      <form className="onboard__form stack stack--lg" onSubmit={submit} noValidate>
        <h2 className="eyebrow">Set up · 4 quick questions</h2>

        <div className="field">
          <label className="label" htmlFor="ob-base">
            Weekly budget
          </label>
          <div className={`money-input${errors.base ? ' is-invalid' : ''}`}>
            <span aria-hidden>$</span>
            <input id="ob-base" className="input input--money" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} aria-invalid={Boolean(errors.base) || undefined} />
          </div>
          {errors.base && <p className="error" role="alert">{errors.base}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="ob-start">
            Start tracking on
          </label>
          <input id="ob-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={Boolean(errors.start) || undefined} />
          <p className={errors.start ? 'error' : 'hint'}>
            {errors.start || (monday ? `Weeks run Monday–Sunday. Your first week is ${formatWeekRange(monday)}.` : '')}
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="ob-open">
            Opening carryover <span className="label__opt">optional</span>
          </label>
          <div className={`money-input${errors.opening ? ' is-invalid' : ''}`}>
            <span aria-hidden>$</span>
            <input id="ob-open" className="input input--money" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} aria-invalid={Boolean(errors.opening) || undefined} />
          </div>
          <p className={errors.opening ? 'error' : 'hint'}>
            {errors.opening || 'Moving from a spreadsheet? Enter what you had left over (or −overspent). Otherwise leave $0.00.'}
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="ob-tz">
            Time zone
          </label>
          <select id="ob-tz" className="input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="hint">Decides when “today” starts and when Monday begins.</p>
        </div>

        {monday && baseParsed.ok && openParsed.ok && (
          <p className="callout" aria-live="polite">
            <strong>Week 1 starts with {formatCents(baseParsed.cents + openParsed.cents)} available.</strong>{' '}
            {openParsed.cents === 0
              ? `That’s your ${formatCents(baseParsed.cents)} budget from ${formatDateLong(monday)}.`
              : `${formatCents(baseParsed.cents)} budget ${openParsed.cents > 0 ? 'plus' : 'minus'} ${formatCents(Math.abs(openParsed.cents))} opening carryover, from ${formatDateLong(monday)}.`}
          </p>
        )}
        {errors.form && <p className="error" role="alert">{errors.form}</p>}

        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          Start tracking
        </button>
      </form>
    </div>
  );
}
