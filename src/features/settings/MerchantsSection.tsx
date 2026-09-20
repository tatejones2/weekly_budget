import { useMemo, useState } from 'react';
import { useData } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { Modal } from '../../components/Modal';
import { renameMerchant } from '../../db/repo';
import { formatCents } from '../../lib/money';
import { cleanText, normalizeName } from '../../lib/validation';
import { buildMerchants, type MerchantStat } from '../expenses/merchants';
import { Section } from './SettingsPage';

export function MerchantsSection() {
  const data = useData();
  const toast = useToast();
  const merchants = useMemo(() => buildMerchants(data.expenses).sort((a, b) => a.name.localeCompare(b.name)), [data.expenses]);
  const [target, setTarget] = useState<MerchantStat | null>(null);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');

  const shown = merchants.filter((m) => !filter || m.key.includes(normalizeName(filter)));
  const cleaned = cleanText(name);
  const mergeInto = target && cleaned && normalizeName(cleaned) !== target.key ? merchants.find((m) => m.key === normalizeName(cleaned)) : undefined;
  const unchanged = !target || !cleaned || cleaned === target.name;

  return (
    <Section id="merchants" title="Places" intro="Fix a spelling or merge duplicates. Renaming updates every matching transaction and shortcut; amounts and dates never change.">
      {merchants.length === 0 ? (
        <p className="hint">Places you spend at will be listed here.</p>
      ) : (
        <>
          {merchants.length > 8 && (
            <div className="field">
              <label className="label" htmlFor="m-filter">Find a place</label>
              <input id="m-filter" type="search" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          <ul className="rows">
            {shown.map((m) => (
              <li key={m.key} className="rows__item">
                <span><strong>{m.name}</strong> <span className="dim">· {m.visits} {m.visits === 1 ? 'visit' : 'visits'} · {formatCents(m.totalCents)}</span></span>
                <button type="button" className="link-btn" aria-label={`Rename ${m.name}`} onClick={() => { setTarget(m); setName(m.name); }}>Rename / merge</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal open={target !== null} onClose={() => setTarget(null)} title="Rename place" size="sm" initialFocus="#m-name">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!target || unchanged) return;
            const n = await renameMerchant(target.name, cleaned);
            toast.show(mergeInto ? `Merged into ${mergeInto.name} (${n} records updated).` : `Renamed to ${cleaned} (${n} records updated).`);
            setTarget(null);
          }}
        >
          <div className="field">
            <label className="label" htmlFor="m-name">New name</label>
            <input id="m-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          {mergeInto && <p className="callout callout--warn">“{mergeInto.name}” already exists. Saving will merge these places, and their history will be combined under “{mergeInto.name}”.</p>}
          <div className="row row--end">
            <button type="button" className="btn" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={unchanged}>{mergeInto ? 'Merge' : 'Rename'}</button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}
