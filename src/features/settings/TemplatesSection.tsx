import { useState } from 'react';
import { useData } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { addTemplate, deleteTemplate, updateTemplate } from '../../db/repo';
import type { PurchaseTemplate } from '../../db/types';
import { centsToInput, formatCents, parseDollars } from '../../lib/money';
import { cleanText } from '../../lib/validation';
import { sortTemplates } from '../templates/templates';
import { Section } from './SettingsPage';

type Draft = { id?: string; merchantName: string; label: string; kind: 'fixed' | 'variable'; amount: string; categoryId: string };

export function TemplatesSection() {
  const data = useData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<PurchaseTemplate | null>(null);
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Unknown';
  const list = sortTemplates(data.templates);

  const blank = (): Draft => ({ merchantName: '', label: '', kind: 'fixed', amount: '', categoryId: data.categories.find((c) => c.id === 'cat-other')?.id ?? data.categories[0]?.id ?? '' });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const errs: Record<string, string> = {};
    if (!cleanText(draft.merchantName)) errs.merchant = 'Enter a place.';
    const amt = parseDollars(draft.amount);
    if (draft.kind === 'fixed' && !amt.ok) errs.amount = amt.error;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = { merchantName: draft.merchantName, label: draft.label, kind: draft.kind, amountCents: draft.kind === 'fixed' && amt.ok ? amt.cents : null, categoryId: draft.categoryId };
    if (draft.id) await updateTemplate(draft.id, payload);
    else await addTemplate(payload);
    toast.show(draft.id ? 'Shortcut updated. Past purchases are unchanged.' : 'Shortcut saved.');
    setDraft(null);
  }

  return (
    <Section id="shortcuts" title="Shortcuts" intro="Fixed shortcuts prefill a set price. Variable shortcuts prefill the place and category but always leave the amount blank. Neither one spends anything until you save a purchase.">
      {list.length === 0 ? (
        <p className="hint">No shortcuts yet. Add one here, or choose “Save as a shortcut” when logging an expense.</p>
      ) : (
        <ul className="rows">
          {list.map((t) => (
            <li key={t.id} className="rows__item">
              <span>
                <strong>{t.label}</strong> <span className="dim">· {t.merchantName} · {catName(t.categoryId)}</span>
                <br />
                <span className="tag">{t.kind === 'fixed' ? 'Fixed' : 'Variable'}</span> <span className="num">{t.kind === 'fixed' && t.amountCents !== null ? formatCents(t.amountCents) : 'amount entered each time'}</span>
                <span className="dim"> · used {t.usageCount}×</span>
              </span>
              <span className="row">
                <button type="button" className="link-btn" aria-label={`Edit ${t.label}`} onClick={() => { setErrors({}); setDraft({ id: t.id, merchantName: t.merchantName, label: t.label, kind: t.kind, amount: t.amountCents !== null ? centsToInput(t.amountCents) : '', categoryId: t.categoryId }); }}>Edit</button>
                <button type="button" className="link-btn link-btn--danger" aria-label={`Delete ${t.label}`} onClick={() => setRemoving(t)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div><button type="button" className="btn" onClick={() => { setErrors({}); setDraft(blank()); }}>Add shortcut</button></div>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? 'Edit shortcut' : 'New shortcut'} size="sm" initialFocus="#t-merchant">
        {draft && (
          <form className="stack" onSubmit={save} noValidate>
            <div className="field">
              <label className="label" htmlFor="t-merchant">Place</label>
              <input id="t-merchant" className="input" value={draft.merchantName} maxLength={120} onChange={(e) => setDraft({ ...draft, merchantName: e.target.value })} aria-invalid={Boolean(errors.merchant) || undefined} />
              {errors.merchant && <p className="error" role="alert">{errors.merchant}</p>}
            </div>
            <div className="field">
              <label className="label" htmlFor="t-label">Name <span className="label__opt">optional</span></label>
              <input id="t-label" className="input" value={draft.label} maxLength={60} placeholder="e.g. Usual order" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </div>
            <fieldset className="field">
              <legend className="label">Type</legend>
              <div className="seg" role="radiogroup" aria-label="Shortcut type">
                {(['fixed', 'variable'] as const).map((k) => (
                  <label key={k} className={`seg__opt${draft.kind === k ? ' is-on' : ''}`}>
                    <input type="radio" name="kind" checked={draft.kind === k} onChange={() => setDraft({ ...draft, kind: k })} />
                    {k === 'fixed' ? 'Fixed price' : 'Variable amount'}
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.kind === 'fixed' && (
              <div className="field">
                <label className="label" htmlFor="t-amount">Price</label>
                <div className={`money-input${errors.amount ? ' is-invalid' : ''}`}>
                  <span aria-hidden>$</span>
                  <input id="t-amount" className="input input--money" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} aria-invalid={Boolean(errors.amount) || undefined} />
                </div>
                {errors.amount && <p className="error" role="alert">{errors.amount}</p>}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="t-cat">Category</label>
              <select id="t-cat" className="input" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="row row--end">
              <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className="btn btn--primary">Save shortcut</button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog open={removing !== null} title="Delete this shortcut?" confirmLabel="Delete" danger onCancel={() => setRemoving(null)} onConfirm={async () => { if (removing) { await deleteTemplate(removing.id); toast.show('Shortcut deleted. Past purchases are unchanged.'); } setRemoving(null); }}>
        <p>“{removing?.label}” will be removed. Transactions you already logged with it stay exactly as they are.</p>
      </ConfirmDialog>
    </Section>
  );
}
