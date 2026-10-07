import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthProvider';
import { DataProvider, useDataState } from './DataProvider';
import { ToastProvider } from './Toasts';
import { AddExpenseProvider } from './AddExpenseProvider';
import { Shell } from './Shell';
import { AuthPage } from '../features/auth/AuthPage';
import { Onboarding } from '../features/onboarding/Onboarding';
import { OverviewPage } from '../features/budget/OverviewPage';
import { TransactionsPage } from '../features/expenses/TransactionsPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { SettingsPage } from '../features/settings/SettingsPage';

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="splash__mark" aria-hidden />
      Loading your budget…
    </div>
  );
}

function DataGate() {
  const state = useDataState();
  if (state.status === 'loading') return <Splash />;
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

function AuthGate() {
  const { state } = useAuth();
  if (state.status === 'checking') return <Splash />;
  if (state.status === 'anonymous') return <AuthPage />;
  return (
    <DataProvider>
      <DataGate />
    </DataProvider>
  );
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  );
}
