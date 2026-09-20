import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useData, useToday } from '../../app/DataProvider';
import { useExpenseActions } from '../../app/AddExpenseProvider';
import { EmptyState } from '../../components/EmptyState';
import { ExpenseRow } from '../../components/ExpenseRow';
import { addDays, addWeeks, formatDayUpper, formatWeekRange, isValidISODate, weekEndOf, weekStartOf, weeksBetween, yearOf } from '../../lib/dates';
import { formatCents, formatCentsCompact, formatSignedCents } from '../../lib/money';
import { calculateWeekSummaries, dailyAllowance, spendByDayOfWeek, weekPhase } from './calc';
import { sortTemplates } from '../templates/templates';
import { downloadBackupNudge } from './nudge';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_FUTURE_WEEKS = 12;

export function OverviewPage() {
  const data = useData();
  const { settings } = data;
  const today = useToday(settings.timeZone);
  const { openAdd, openEdit, askDelete } = useExpenseActions();
  const [params, setParams] = useSearchParams();

  const currentWeek = weekStartOf(today);
  const minWeek = settings.firstWeekStart;
  const maxWeek = addWeeks(currentWeek, MAX_FUTURE_WEEKS);

  const requested = params.get('week');
  let viewed = requested && isValidISODate(requested) ? weekStartOf(requested) : currentWeek;
  if (viewed < minWeek) viewed = minWeek;
  if (viewed > maxWeek) viewed = maxWeek;
  const phase = weekPhase(viewed, today);

  const goto = (w: string) => {
    if (w === currentWeek) setParams({}, { replace: true });
    else setParams({ week: w }, { replace: true });
  };

  const summaries = useMemo(
    () =>
      calculateWeekSummaries(
        { firstWeekStart: settings.firstWeekStart, openingCarryoverCents: settings.openingCarryoverCents, budgetChanges: data.budgetChanges, expenses: data.expenses },
        viewed,
      ),
    [settings.firstWeekStart, settings.openingCarryoverCents, data.budgetChanges, data.expenses, viewed],
  );
  const week = summaries[summaries.length - 1]!;
  const weekNumber = weeksBetween(minWeek, viewed) + 1;
  const isFirstWeek = viewed === minWeek;

  const weekExpenses = useMemo(
    () =>
      data.expenses
        .filter((e) => e.date >= viewed && e.date <= weekEndOf(viewed))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [data.expenses, viewed],
  );
  const perDay = useMemo(() => spendByDayOfWeek(viewed, data.expenses), [viewed, data.expenses]);
  const templates = useMemo(() => sortTemplates(data.templates).slice(0, 8), [data.templates]);
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Unknown';
  const nudge = downloadBackupNudge(data);

  const { remainingCents, spentCents, startingAvailableCents, carryInCents, baseCents } = week;
  const over = remainingCents < 0;
  const daily = dailyAllowance(remainingCents, today);
  const overdrawnAtStart = startingAvailableCents < 0;

  const heroLabel = phase === 'future' ? 'Forecast remaining' : phase === 'past' ? (over ? 'Week ended overspent' : 'Week ended with') : over ? 'Overspent this week' : 'Remaining this week';
  const heroValue = over ? formatCents(-remainingCents) : formatCents(remainingCents);

  let carryNote: string;
  const carryAbs = formatCents(Math.abs(carryInCents));
  if (isFirstWeek) {
    carryNote = carryInCents === 0 ? 'No opening carryover — this week starts at the base allowance.' : carryInCents > 0 ? `Your opening balance adds ${carryAbs} to this week.` : `Your opening balance takes ${carryAbs} off this week.`;
  } else if (carryInCents > 0) carryNote = `You brought ${carryAbs} forward from last week.`;
  else if (carryInCents < 0) carryNote = `You started ${carryAbs} below your usual allowance after last week.`;
  else carryNote = 'Last week ended exactly on budget — nothing carried over.';

  const usedPct = startingAvailableCents > 0 ? Math.min(100, Math.max(0, (spentCents / startingAvailableCents) * 100)) : spentCents > 0 || overdrawnAtStart ? 100 : 0;
  const meterOver = over && (spentCents > 0 || overdrawnAtStart);
  const overAmount = -remainingCents;
  const meterLabel = meterOver
    ? `Over budget by ${formatCents(overAmount)}: spent ${formatCents(spentCents)} of ${formatCents(startingAvailableCents)} available.`
    : `Spent ${formatCents(spentCents)} of ${formatCents(startingAvailableCents)} available, ${formatCents(remainingCents)} left.`;

  return (
    <div className="page">
      {nudge && (
        <p className="banner">
          {nudge} <Link to="/settings#data">Back up now</Link>
        </p>
      )}

      <section className="weekbar" aria-label="Week">
        <div className="weekbar__title">
          <p className="eyebrow">
            Week {weekNumber} ·{' '}
            <span className={`phase phase--${phase}`}>{phase === 'current' ? 'Current week' : phase === 'past' ? 'Historical' : 'Forecast'}</span>
          </p>
          <h1 className="weekbar__range">{formatWeekRange(viewed, yearOf(today))}</h1>
        </div>
        <div className="weekbar__nav">
          <button type="button" className="icon-btn icon-btn--box" aria-label="Previous week" disabled={viewed <= minWeek} onClick={() => goto(addWeeks(viewed, -1))}>
            <ChevronLeft size={20} aria-hidden />
          </button>
          <button type="button" className="btn btn--sm" disabled={viewed === currentWeek} onClick={() => goto(currentWeek)}>
            Today
          </button>
          <button type="button" className="icon-btn icon-btn--box" aria-label="Next week" disabled={viewed >= maxWeek} onClick={() => goto(addWeeks(viewed, 1))}>
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
      </section>

      <section className={`hero${over ? ' hero--over' : ''}`} aria-labelledby="hero-label">
        <div className="hero__main">
          <p id="hero-label" className="eyebrow">
            {heroLabel}
          </p>
          <p className="hero__figure num" aria-live="polite">
            {over && <span className="hero__sign" aria-hidden>−</span>}
            {heroValue}
            {over && <span className="sr-only"> over budget</span>}
          </p>
          <p className="hero__sub">
            {phase === 'current' &&
              (over
                ? overdrawnAtStart && spentCents <= 0
                  ? `This week’s allowance started ${formatCents(-startingAvailableCents)} overdrawn.`
                  : `${formatCents(spentCents)} spent of ${formatCents(startingAvailableCents)} available. The overage comes out of next week.`
                : `${formatCents(spentCents)} spent of ${formatCents(startingAvailableCents)} available.`)}
            {phase === 'past' && (over ? `${formatCents(overAmount)} carried into the next week as a deficit.` : remainingCents === 0 ? 'Nothing carried into the next week.' : `${formatCents(remainingCents)} carried into the next week.`)}
            {phase === 'future' && 'Projection from what’s logged so far — it shifts as earlier weeks change.'}
          </p>
        </div>

        <div className="hero__side">
          {phase === 'current' ? (
            <>
              <p className="eyebrow">Per day, rest of week</p>
              <p className="hero__daily num">
                {formatCents(daily.perDayCents)}
                <span className="hero__unit">/day</span>
              </p>
              <p className="hero__sub" aria-live="polite">
                {daily.overspent
                  ? `Over by ${formatCents(overAmount)} — nothing left to spend safely.`
                  : remainingCents === 0
                    ? 'Nothing left this week.'
                    : `${formatCents(remainingCents)} left · ${daily.daysRemaining} ${daily.daysRemaining === 1 ? 'day' : 'days'} including today · ${formatCents(daily.perDayCents)}/day.`}
                {daily.leftoverCents > 0 && daily.daysRemaining > 1 && ` Sunday can take ${formatCents(daily.perDayCents + daily.leftoverCents)}.`}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">{phase === 'past' ? 'Carried forward' : 'Projected carry'}</p>
              <p className="hero__daily num">{formatSignedCents(week.carryOutCents)}</p>
              <p className="hero__sub">{phase === 'past' ? 'Historical week — no daily projection.' : 'Forecast only. Nothing here is actual spending.'}</p>
            </>
          )}
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => openAdd(phase === 'current' ? {} : { date: phase === 'past' ? weekEndOf(viewed) : viewed })}>
            <Plus size={20} aria-hidden /> Add expense
          </button>
        </div>
      </section>

      <section aria-label="How this week adds up" className="block">
        <h2 className="eyebrow">How it adds up</h2>
        <dl className="equation">
          <div className="eq">
            <dt>Base allowance</dt>
            <dd className="num">{formatCents(baseCents)}</dd>
          </div>
          <span className="eq__op" aria-hidden>{carryInCents < 0 ? '−' : '+'}</span>
          <div className="eq">
            <dt>{isFirstWeek ? 'Opening carryover' : 'Carried in'}</dt>
            <dd className={`num ${carryInCents < 0 ? 'neg' : carryInCents > 0 ? 'pos' : ''}`}>{formatSignedCents(carryInCents)}</dd>
          </div>
          <span className="eq__op" aria-hidden>=</span>
          <div className="eq eq--strong">
            <dt>Available</dt>
            <dd className={`num ${overdrawnAtStart ? 'neg' : ''}`}>{formatCents(startingAvailableCents)}</dd>
          </div>
          <span className="eq__op" aria-hidden>−</span>
          <div className="eq">
            <dt>{phase === 'future' ? 'Logged spending' : 'Spent'}</dt>
            <dd className="num">{formatCents(spentCents)}</dd>
          </div>
          <span className="eq__op" aria-hidden>=</span>
          <div className="eq eq--strong">
            <dt>{over ? 'Overspent' : 'Remaining'}</dt>
            <dd className={`num ${over ? 'neg' : ''}`}>{formatCents(remainingCents)}</dd>
          </div>
        </dl>
        <p className={`note ${carryInCents < 0 ? 'note--neg' : carryInCents > 0 ? 'note--pos' : ''}`}>{carryNote}</p>

        <div
          className={`meter${meterOver ? ' meter--over' : ''}`}
          role="img"
          aria-label={meterLabel}
        >
          <div className="meter__fill" style={{ width: `${usedPct}%` }} />
        </div>
        <div className="meter__legend" aria-hidden>
          <span>{meterOver ? `OVER BY ${formatCents(overAmount)}` : `${Math.round(usedPct)}% USED`}</span>
          <span>{formatCents(Math.max(startingAvailableCents, 0))} AVAILABLE</span>
        </div>
      </section>

      <section aria-label="Spending by day" className="block">
        <h2 className="eyebrow">By day</h2>
        <ol className="days">
          {perDay.map((cents, i) => {
            const iso = addDays(viewed, i);
            const isToday = iso === today;
            const future = iso > today;
            return (
              <li key={i} className={`day${isToday ? ' is-today' : ''}${future ? ' is-future' : ''}`} aria-current={isToday ? 'date' : undefined}>
                <span className="day__letter" aria-hidden>{DAY_LETTERS[i]}</span>
                <span className="sr-only">{DAY_NAMES[i]}{isToday ? ' (today)' : ''}: </span>
                <span className="day__num">{Number(iso.slice(8))}</span>
                <span className="day__amt num">{cents === 0 ? '—' : formatCentsCompact(cents)}</span>
                {isToday && <span className="day__tag" aria-hidden>TODAY</span>}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="cols">
        <section aria-label="Quick add" className="block cols__side">
          <h2 className="eyebrow">Quick add</h2>
          {templates.length === 0 ? (
            <p className="hint">
              Shortcuts for places you visit often will show up here. Save one from the “Save as a shortcut” option when you add an expense.
            </p>
          ) : (
            <ul className="quick">
              {templates.map((t) => (
                <li key={t.id}>
                  <button type="button" className="quick__btn" onClick={() => openAdd({ template: t, ...(phase === 'current' ? {} : { date: phase === 'past' ? weekEndOf(viewed) : viewed }) })}>
                    <span className="quick__name">{t.label}</span>
                    <span className="quick__meta">{t.kind === 'fixed' && t.amountCents !== null ? `${formatCents(t.amountCents)} · fixed` : 'amount varies'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/settings#shortcuts" className="link-quiet">Manage shortcuts</Link>
        </section>

        <section aria-label="Recent transactions" className="block cols__main">
          <div className="block__head">
            <h2 className="eyebrow">{phase === 'current' ? 'Recent' : `Transactions · ${formatDayUpper(viewed)}`}</h2>
            <Link to={`/transactions?week=${viewed}`} className="link-quiet">View all</Link>
          </div>
          {weekExpenses.length === 0 ? (
            <EmptyState
              title={phase === 'future' ? 'Nothing planned for this week' : 'No purchases yet'}
              action={
                <button type="button" className="btn" onClick={() => openAdd(phase === 'current' ? {} : { date: phase === 'past' ? weekEndOf(viewed) : viewed })}>
                  Add the first one
                </button>
              }
            >
              {phase === 'current' ? `The full ${formatCents(startingAvailableCents)} is yours to spend. Add a purchase and this page updates instantly.` : 'Nothing logged in this week.'}
            </EmptyState>
          ) : (
            <ul className="txlist">
              {weekExpenses.slice(0, 8).map((e) => (
                <ExpenseRow key={e.id} expense={e} categoryName={catName(e.categoryId)} yearOf={yearOf(today)} onEdit={openEdit} onDelete={askDelete} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
