import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useToday } from '../../app/DataProvider';
import { useExpenseActions } from '../../app/AddExpenseProvider';
import { BarChart, type Bar } from '../../components/BarChart';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { EmptyState } from '../../components/EmptyState';
import { diffDays, formatDateShort, formatDayUpper, formatWeekRange, maxDate, minDate, weekEndOf, weekStartOf, yearOf } from '../../lib/dates';
import { formatCents, formatSignedCents } from '../../lib/money';
import { calculateWeekSummaries } from '../budget/calc';
import { inRange, resolveRange, type DateRange, type RangePreset } from '../expenses/filters';
import { categoryBreakdown, largestPurchases, merchantBreakdown, weekdayPattern } from './aggregate';

const PRESETS: RangePreset[] = ['last-4', 'last-12', 'this-week', 'last-week', 'this-month', 'all', 'custom'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function InsightsPage() {
  const data = useData();
  const { settings } = data;
  const today = useToday(settings.timeZone);
  const { openAdd } = useExpenseActions();
  const [preset, setPreset] = useState<RangePreset>('last-12');
  const [custom, setCustom] = useState<DateRange>({});
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const [showAllMerchants, setShowAllMerchants] = useState(false);

  const currentWeek = weekStartOf(today);
  const resolved = resolveRange(preset, today, custom);
  // Clamp to the tracked period: nothing before the first week, nothing invented for the future.
  const from = maxDate(resolved.from ?? settings.firstWeekStart, settings.firstWeekStart);
  const to = minDate(resolved.to ?? weekEndOf(currentWeek), weekEndOf(currentWeek));
  const rangeValid = from <= to;

  const inScope = useMemo(() => (rangeValid ? data.expenses.filter((e) => inRange(e.date, { from, to })) : []), [data.expenses, from, to, rangeValid]);

  const summaries = useMemo(
    () => calculateWeekSummaries({ firstWeekStart: settings.firstWeekStart, openingCarryoverCents: settings.openingCarryoverCents, budgetChanges: data.budgetChanges, expenses: data.expenses }, currentWeek),
    [settings.firstWeekStart, settings.openingCarryoverCents, data.budgetChanges, data.expenses, currentWeek],
  );
  const weeksInRange = useMemo(() => (rangeValid ? summaries.filter((w) => w.weekEnd >= from && w.weekStart <= to) : []), [summaries, from, to, rangeValid]);

  const cats = useMemo(() => categoryBreakdown(inScope, data.categories), [inScope, data.categories]);
  const merchants = useMemo(() => merchantBreakdown(inScope), [inScope]);
  const biggest = useMemo(() => largestPurchases(inScope, 5), [inScope]);
  const netSpent = inScope.reduce((s, e) => s + (e.type === 'refund' ? -e.amountCents : e.amountCents), 0);
  const weeklyAvg = weeksInRange.length ? Math.round(weeksInRange.reduce((s, w) => s + w.spentCents, 0) / weeksInRange.length) : 0;

  const dayFrom = from;
  const dayTo = minDate(to, today);
  const pattern = useMemo(() => (dayFrom <= dayTo ? weekdayPattern(inScope, dayFrom, dayTo) : []), [inScope, dayFrom, dayTo]);
  const patternOk = dayFrom <= dayTo && diffDays(dayFrom, dayTo) >= 20 && inScope.length >= 8;
  const patternMax = Math.max(1, ...pattern.map((p) => p.avgCents));

  const chartWeeks = weeksInRange.slice(-16);
  const bars: Bar[] = chartWeeks.map((w) => ({
    label: formatDayUpper(w.weekStart).slice(4),
    value: w.spentCents,
    marker: Math.max(w.startingAvailableCents, 0),
    highlight: w.weekStart === currentWeek,
    title: `Week of ${formatDayUpper(w.weekStart)}: spent ${formatCents(w.spentCents)} of ${formatCents(w.startingAvailableCents)} available`,
  }));

  const y = yearOf(today);
  const historyRows = [...weeksInRange].reverse();
  const shownHistory = showAllWeeks ? historyRows : historyRows.slice(0, 12);
  const shownMerchants = showAllMerchants ? merchants : merchants.slice(0, 8);

  if (data.expenses.length === 0) {
    return (
      <div className="page">
        <header className="pagehead">
          <div>
            <p className="eyebrow">Where it went</p>
            <h1 className="h1">Insights</h1>
          </div>
        </header>
        <EmptyState title="Nothing to analyze yet" action={<button type="button" className="btn btn--primary" onClick={() => openAdd()}>Add an expense</button>}>
          Once you log purchases, this page will show weekly history, spending by category and place, your busiest weekdays, and your biggest purchases — all from your own data.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <p className="eyebrow">Where it went</p>
          <h1 className="h1">Insights</h1>
        </div>
      </header>

      <form className="filters filters--insights" onSubmit={(e) => e.preventDefault()} aria-label="Insights period">
        <DateRangeFilter idPrefix="in" preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} presets={PRESETS} />
        <p className="hint filters__range">{rangeValid ? `${formatDateShort(from, y)} – ${formatDateShort(to, y)}` : 'Choose a valid range.'}</p>
      </form>

      {!rangeValid || inScope.length === 0 ? (
        <EmptyState title="No transactions in this period">Pick a wider period to see your spending patterns.</EmptyState>
      ) : (
        <>
          <dl className="stats">
            <div className="stat"><dt>Net spent</dt><dd className="num">{formatCents(netSpent)}</dd></div>
            <div className="stat"><dt>Weekly average</dt><dd className="num">{formatCents(weeklyAvg)}</dd></div>
            <div className="stat"><dt>Transactions</dt><dd className="num">{inScope.length}</dd></div>
            <div className="stat"><dt>Top category</dt><dd>{cats[0]?.name ?? '—'}</dd></div>
          </dl>

          <section className="block" aria-labelledby="h-trend">
            <h2 id="h-trend" className="eyebrow">Weekly spending vs. available</h2>
            {chartWeeks.length < 2 ? (
              <p className="hint">A trend appears once you have at least two weeks of history.</p>
            ) : (
              <BarChart bars={bars} markerLabel="Available at start of week" ariaLabel={`Weekly spending for the last ${chartWeeks.length} weeks. Exact figures are in the table below.`} />
            )}
          </section>

          <section className="block" aria-labelledby="h-weeks">
            <h2 id="h-weeks" className="eyebrow">Weekly history &amp; carryover</h2>
            <div className="tablewrap">
              <table className="table">
                <caption className="sr-only">Each week’s starting balance, spending, and what carried into the next week</caption>
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col" className="r">Base</th>
                    <th scope="col" className="r">Carry in</th>
                    <th scope="col" className="r">Available</th>
                    <th scope="col" className="r">Spent</th>
                    <th scope="col" className="r">Carry out</th>
                  </tr>
                </thead>
                <tbody>
                  {shownHistory.map((w) => (
                    <tr key={w.weekStart}>
                      <th scope="row">
                        <Link to={`/?week=${w.weekStart}`}>{formatWeekRange(w.weekStart, y)}</Link>
                        {w.weekStart === currentWeek && <span className="tag">Now</span>}
                        {w.spentCents === 0 && <span className="tag tag--quiet">No spending</span>}
                      </th>
                      <td className="r num" data-label="Base">{formatCents(w.baseCents)}</td>
                      <td className="r num" data-label="Carry in">{formatSignedCents(w.carryInCents)}</td>
                      <td className={`r num${w.startingAvailableCents < 0 ? ' neg' : ''}`} data-label="Available">{formatCents(w.startingAvailableCents)}</td>
                      <td className="r num" data-label="Spent">{formatCents(w.spentCents)}</td>
                      <td className={`r num strong${w.carryOutCents < 0 ? ' neg' : ''}`} data-label="Carry out">{formatSignedCents(w.carryOutCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {historyRows.length > 12 && (
              <button type="button" className="btn btn--sm" onClick={() => setShowAllWeeks((v) => !v)}>
                {showAllWeeks ? 'Show fewer weeks' : `Show all ${historyRows.length} weeks`}
              </button>
            )}
            <p className="hint">Carry out = available − spent, and becomes next week’s carry in. Weeks with no spending still add the base allowance.</p>
          </section>

          <div className="cols cols--even">
            <section className="block" aria-labelledby="h-cat">
              <h2 id="h-cat" className="eyebrow">By category</h2>
              {cats.length === 0 ? (
                <p className="hint">No net spending in this period.</p>
              ) : (
                <ul className="hbars">
                  {cats.map((c) => (
                    <li key={c.id} className="hbar">
                      <div className="hbar__head">
                        <span>{c.name}</span>
                        <span className="num">{formatCents(c.cents)} <span className="dim">· {Math.round(c.share * 100)}%</span></span>
                      </div>
                      <div className="hbar__track" aria-hidden><div className="hbar__fill" style={{ width: `${Math.max(c.share * 100, 1.5)}%` }} /></div>
                      <span className="sr-only">{c.count} purchases</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="block" aria-labelledby="h-day">
              <h2 id="h-day" className="eyebrow">By weekday · average</h2>
              {!patternOk ? (
                <p className="hint">A weekday pattern needs about three weeks and at least 8 transactions in the period. Keep logging and it will appear here.</p>
              ) : (
                <ul className="hbars">
                  {pattern.map((p) => (
                    <li key={p.index} className="hbar">
                      <div className="hbar__head">
                        <span>{WEEKDAYS[p.index]}</span>
                        <span className="num">{formatCents(p.avgCents)}<span className="dim"> /day</span></span>
                      </div>
                      <div className="hbar__track" aria-hidden><div className="hbar__fill" style={{ width: `${(p.avgCents / patternMax) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="block" aria-labelledby="h-merch">
            <h2 id="h-merch" className="eyebrow">Places</h2>
            <div className="tablewrap">
              <table className="table">
                <caption className="sr-only">Spending by place</caption>
                <thead>
                  <tr>
                    <th scope="col">Place</th>
                    <th scope="col" className="r">Total</th>
                    <th scope="col" className="r">Visits</th>
                    <th scope="col" className="r">Average</th>
                    <th scope="col" className="r">Last visit</th>
                  </tr>
                </thead>
                <tbody>
                  {shownMerchants.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">{m.name}</th>
                      <td className="r num strong" data-label="Total">{formatCents(m.totalCents)}</td>
                      <td className="r num" data-label="Visits">{m.visits}</td>
                      <td className="r num" data-label="Average">{m.visits ? formatCents(m.avgCents) : '—'}</td>
                      <td className="r" data-label="Last visit">{formatDateShort(m.lastDate, y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {merchants.length > 8 && (
              <button type="button" className="btn btn--sm" onClick={() => setShowAllMerchants((v) => !v)}>
                {showAllMerchants ? 'Show fewer' : `Show all ${merchants.length} places`}
              </button>
            )}
          </section>

          <section className="block" aria-labelledby="h-big">
            <h2 id="h-big" className="eyebrow">Largest purchases</h2>
            <ol className="ranked">
              {biggest.map((e, i) => (
                <li key={e.id}>
                  <span className="ranked__n" aria-hidden>{i + 1}</span>
                  <span className="ranked__name">{e.merchantName}<span className="dim"> · {formatDateShort(e.date, y)}</span></span>
                  <span className="num strong">{formatCents(e.amountCents)}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
