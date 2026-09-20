import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { useData, useToday } from '../../app/DataProvider';
import { useExpenseActions } from '../../app/AddExpenseProvider';
import { DateRangeFilter } from '../../components/DateRangeFilter';
import { EmptyState } from '../../components/EmptyState';
import { ExpenseRow } from '../../components/ExpenseRow';
import { downloadFile } from '../../db/backup';
import { expensesToCsv } from '../../db/csv';
import { formatCents } from '../../lib/money';
import { formatWeekRange, isValidISODate, weekEndOf, weekStartOf, yearOf } from '../../lib/dates';
import { filterExpenses, netTotal, resolveRange, sortExpenses, SORT_LABELS, type DateRange, type RangePreset, type SortKey } from './filters';
import { buildMerchants } from './merchants';
import { spendDelta } from '../budget/calc';

const PAGE = 100;

export function TransactionsPage() {
  const data = useData();
  const today = useToday(data.settings.timeZone);
  const { openAdd, openEdit, askDelete } = useExpenseActions();
  const [params, setParams] = useSearchParams();

  // "?week=YYYY-MM-DD" (from the Overview) preselects that week as a custom range.
  const weekParam = params.get('week');
  const weekFromUrl = weekParam && isValidISODate(weekParam) ? weekStartOf(weekParam) : null;

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [preset, setPreset] = useState<RangePreset>(weekFromUrl ? 'custom' : 'all');
  const [custom, setCustom] = useState<DateRange>(weekFromUrl ? { from: weekFromUrl, to: weekEndOf(weekFromUrl) } : {});
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [limit, setLimit] = useState(PAGE);

  const range = resolveRange(preset, today, custom);
  const merchants = useMemo(() => buildMerchants(data.expenses).sort((a, b) => a.name.localeCompare(b.name)), [data.expenses]);
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Unknown';

  const filtered = useMemo(
    () => sortExpenses(filterExpenses(data.expenses, { query, categoryId, merchant, range }), sort),
    [data.expenses, query, categoryId, merchant, range.from, range.to, sort], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const total = netTotal(filtered);
  const filtersActive = Boolean(query || categoryId || merchant || preset !== 'all');
  const visible = filtered.slice(0, limit);

  // Group by week only when sorting by date so the ledger stays a real timeline.
  const weekTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtered) m.set(weekStartOf(e.date), (m.get(weekStartOf(e.date)) ?? 0) + spendDelta(e));
    return m;
  }, [filtered]);
  const groups = useMemo(() => {
    if (sort !== 'date-desc' && sort !== 'date-asc') return null;
    const map = new Map<string, typeof visible>();
    for (const e of visible) {
      const w = weekStartOf(e.date);
      map.set(w, [...(map.get(w) ?? []), e]);
    }
    return [...map.entries()];
  }, [visible, sort]);

  const clear = () => {
    setQuery('');
    setCategoryId('');
    setMerchant('');
    setPreset('all');
    setCustom({});
    if (weekParam) setParams({}, { replace: true });
  };

  const renderRow = (e: (typeof filtered)[number]) => (
    <ExpenseRow key={e.id} expense={e} categoryName={catName(e.categoryId)} yearOf={yearOf(today)} onEdit={openEdit} onDelete={askDelete} />
  );

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1 className="h1">Transactions</h1>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={data.expenses.length === 0} onClick={() => downloadFile(`weekly-transactions-${today}.csv`, expensesToCsv(filtered, data.categories), 'text/csv;charset=utf-8')}>
            <Download size={16} aria-hidden /> Export CSV{filtersActive ? ' (filtered)' : ''}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => openAdd()}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      </header>

      {data.expenses.length === 0 ? (
        <EmptyState title="No transactions yet" action={<button type="button" className="btn btn--primary" onClick={() => openAdd()}>Add your first expense</button>}>
          Every purchase you log shows up here — searchable by place or note, filterable by week, category and merchant.
        </EmptyState>
      ) : (
        <>
          <form className="filters" role="search" aria-label="Filter transactions" onSubmit={(e) => e.preventDefault()}>
            <div className="field field--search">
              <label className="label" htmlFor="tx-q">Search</label>
              <input id="tx-q" type="search" className="input" placeholder="Place or note" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
            </div>
            <div className="field">
              <label className="label" htmlFor="tx-cat">Category</label>
              <select id="tx-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All categories</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tx-m">Place</label>
              <select id="tx-m" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)}>
                <option value="">All places</option>
                {merchants.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
            </div>
            <DateRangeFilter idPrefix="tx" preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} />
            <div className="field">
              <label className="label" htmlFor="tx-sort">Sort</label>
              <select id="tx-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
              </select>
            </div>
          </form>

          <div className="totalbar" role="status" aria-live="polite">
            <span>
              <strong>{filtered.length}</strong> {filtered.length === 1 ? 'transaction' : 'transactions'}
              {filtersActive && <> · <button type="button" className="link-btn" onClick={clear}>Clear filters</button></>}
            </span>
            <span className="totalbar__sum">
              Net spent <strong className="num">{formatCents(total)}</strong>
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Nothing matches" action={<button type="button" className="btn" onClick={clear}>Clear filters</button>}>
              Try a different search or widen the date range.
            </EmptyState>
          ) : groups ? (
            groups.map(([week, rows]) => (
              <section key={week} className="group" aria-label={formatWeekRange(week, yearOf(today))}>
                <h2 className="group__head">
                  <span>{formatWeekRange(week, yearOf(today))}</span>
                  <span className="num">{formatCents(weekTotals.get(week) ?? 0)}</span>
                </h2>
                <ul className="txlist">{rows.map(renderRow)}</ul>
              </section>
            ))
          ) : (
            <ul className="txlist">{visible.map(renderRow)}</ul>
          )}

          {filtered.length > limit && (
            <div className="row row--center">
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({filtered.length - limit} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
