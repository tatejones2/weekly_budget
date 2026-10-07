/**
 * Replaces Dexie's automatic live-query reactivity. Every successful write in
 * `db/repo.ts` calls `notifyDataChanged()`; `DataProvider` subscribes and
 * refetches `/api/data`, so every screen updates after any write exactly like
 * before — just via an explicit signal instead of IndexedDB change tracking.
 */
const listeners = new Set<() => void>();

export function notifyDataChanged(): void {
  listeners.forEach((l) => l());
}

export function onDataChanged(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
