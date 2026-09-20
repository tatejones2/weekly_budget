import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { AppData } from '../db/types';
import { msUntilMidnight, todayInZone } from '../lib/dates';

type DataState =
  | { status: 'loading' }
  | { status: 'empty' } // database open, onboarding not done
  | { status: 'ready'; data: AppData };

const DataContext = createContext<DataState>({ status: 'loading' });

/** Loads the whole (small, single-user) dataset reactively; any write re-renders consumers. */
export function DataProvider({ children }: { children: ReactNode }) {
  const settingsRows = useLiveQuery(() => db.settings.toArray(), []);
  const budgetChanges = useLiveQuery(() => db.budgetChanges.toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []);
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);

  const state = useMemo<DataState>(() => {
    if (!settingsRows || !budgetChanges || !categories || !templates || !expenses) return { status: 'loading' };
    const settings = settingsRows[0];
    if (!settings) return { status: 'empty' };
    return { status: 'ready', data: { settings, budgetChanges, categories, templates, expenses } };
  }, [settingsRows, budgetChanges, categories, templates, expenses]);

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
