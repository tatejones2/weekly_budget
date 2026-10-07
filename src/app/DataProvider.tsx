import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request } from '../api/client';
import { onDataChanged } from './dataBus';
import type { AppData } from '../db/types';
import { msUntilMidnight, todayInZone } from '../lib/dates';

type DataState =
  | { status: 'loading' }
  | { status: 'empty' } // signed in, onboarding not done yet
  | { status: 'ready'; data: AppData };

const DataContext = createContext<DataState>({ status: 'loading' });

type RawAppData = {
  settings: AppData['settings'] | null;
  budgetChanges: AppData['budgetChanges'];
  categories: AppData['categories'];
  templates: AppData['templates'];
  expenses: AppData['expenses'];
};

/**
 * Loads the whole (small, single-user) dataset from `GET /api/data` and
 * refetches whenever any write happens anywhere in the app (see `dataBus.ts`)
 * — the server-backed equivalent of Dexie's live-query reactivity. Every
 * screen that calls `useData()` keeps working unchanged.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<RawAppData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      request<RawAppData>('/api/data')
        .then((data) => {
          if (!cancelled) setRaw(data);
        })
        .catch(() => {
          // A 401 here means the session ended between render and fetch (e.g.
          // signing out while a refetch was in flight); AuthProvider's own
          // onUnauthorized handler already swaps the whole app back to the
          // login screen, unmounting this provider — nothing more to do here.
        });
    };
    load();
    const unsubscribe = onDataChanged(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const state = useMemo<DataState>(() => {
    if (!raw) return { status: 'loading' };
    if (!raw.settings) return { status: 'empty' };
    return {
      status: 'ready',
      data: { settings: raw.settings, budgetChanges: raw.budgetChanges, categories: raw.categories, templates: raw.templates, expenses: raw.expenses },
    };
  }, [raw]);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useDataState(): DataState {
  return useContext(DataContext);
}

/** For screens rendered only once onboarding is complete. */
export function useData(): AppData {
  const s = useContext(DataContext);
  if (s.status !== 'ready') throw new Error('useData called before data is ready');
  return s.data;
}

/** Today's date in the budgeting time zone; rolls over at local midnight and when the tab wakes up. */
export function useToday(timeZone: string): string {
  const [today, setToday] = useState(() => todayInZone(timeZone));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setToday(todayInZone(timeZone));
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilMidnight(timeZone) + 250);
    };
    refresh();
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [timeZone]);
  return today;
}
