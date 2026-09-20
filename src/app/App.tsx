import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DataProvider, useDataState } from './DataProvider';
import { ToastProvider } from './Toasts';
import { AddExpenseProvider } from './AddExpenseProvider';
import { Shell } from './Shell';
import { Onboarding } from '../features/onboarding/Onboarding';
import { OverviewPage } from '../features/budget/OverviewPage';
import { TransactionsPage } from '../features/expenses/TransactionsPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { SettingsPage } from '../features/settings/SettingsPage';

function Gate() {
  const state = useDataState();
  if (state.status === 'loading') {
    return (
      <div className="splash" role="status" aria-live="polite">
        <span className="splash__mark" aria-hidden />
        Loading your budget…
      </div>
    );
  }
  if (state.status === 'empty') return <Onboarding />;
  return (
    <AddExpenseProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<OverviewPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AddExpenseProvider>
  );
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <DataProvider>
          <Gate />
        </DataProvider>
      </ToastProvider>
    </HashRouter>
  );
}
