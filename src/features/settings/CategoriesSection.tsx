import { useState } from 'react';
import { useData } from '../../app/DataProvider';
import { useToast } from '../../app/Toasts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { addCategory, deleteCategory, renameCategory } from '../../db/repo';
import type { Category } from '../../db/types';
import { Section } from './SettingsPage';

export function CategoriesSection() {
  const data = useData();
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [target, setTarget] = useState('');

  const usage = (id: string) => data.expenses.filter((e) => e.categoryId === id).length + data.templates.filter((t) => t.categoryId === id).length;
  const others = removing ? data.categories.filter((c) => c.id !== removing.id) : [];

  return (
    <Section id="categories" title="Categories" intro="Rename freely — past transactions follow. Deleting a category moves its transactions to another one.">
      <ul className="rows">
        {data.categories.map((c) => (
          <li key={c.id} className="rows__item">
            {editing?.id === c.id ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await renameCategory(c.id, editing.name);
                  if (!ok) toast.show('That name is empty or already used.', { tone: 'error' });
                  else setEditing(null);
                }}
              >
                <label className="sr-only" htmlFor={`cat-${c.id}`}>Category name</label>
                <input id={`cat-${c.id}`} className="input" value={editing.name} maxLength={40} autoFocus onChange={(e) => setEditing({ id: c.id, name: e.target.value })} />
                <button className="btn btn--sm btn--primary" type="submit">Save</button>
                <button className="btn btn--sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span><strong>{c.name}</strong> <span className="dim">· {usage(c.id)} in use</span></span>
                <span className="row">
                  <button type="button" className="link-btn" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>Rename</button>
                  {data.categories.length > 1 && (
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => {
                        setRemoving(c);
                        setTarget(data.categories.find((x) => x.id !== c.id && x.id === 'cat-other')?.id ?? data.categories.find((x) => x.id !== c.id)!.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const c = await addCategory(newName);
          if (!c) toast.show('Enter a new, unique category name.', { tone: 'error' });
          else setNewName('');
        }}
      >
        <label className="sr-only" htmlFor="cat-new">New category name</label>
        <input id="cat-new" className="input" value={newName} placeholder="New category" maxLength={40} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn" type="submit">Add category</button>
      </form>

      <ConfirmDialog
        open={removing !== null}
        title={`Delete “${removing?.name ?? ''}”?`}
        confirmLabel="Delete category"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await deleteCategory(removing.id, target);
          toast.show(`Deleted ${removing.name}.`);
          setRemoving(null);
        }}
      >
        <div className="stack">
          <p>{usage(removing?.id ?? '')} transactions and shortcuts use this category. Move them to:</p>
          <label className="sr-only" htmlFor="cat-target">Move to category</label>
          <select id="cat-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </ConfirmDialog>
    </Section>
  );
}
