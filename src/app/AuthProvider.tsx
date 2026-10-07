import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, request, setUnauthorizedHandler } from '../api/client';

export type AuthUser = { id: string; email: string; name: string | null };

type AuthState = { status: 'checking' } | { status: 'anonymous' } | { status: 'authenticated'; user: AuthUser };

type AuthApi = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    // A 401 from anywhere in the app (not just /auth/me) means the session
    // ended — drop back to the login screen instead of showing broken data.
    setUnauthorizedHandler(() => setState({ status: 'anonymous' }));
    request<{ user: AuthUser }>('/api/auth/me')
      .then(({ user }) => setState({ status: 'authenticated', user }))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) setState({ status: 'anonymous' });
        else setState({ status: 'anonymous' }); // network hiccup — let the user retry via the login form
      });
    return () => setUnauthorizedHandler(null);
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      login: async (email, password) => {
        const { user } = await request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: { email, password } });
        setState({ status: 'authenticated', user });
      },
      register: async (email, password, name) => {
        const { user } = await request<{ user: AuthUser }>('/api/auth/register', { method: 'POST', body: { email, password, name } });
        setState({ status: 'authenticated', user });
      },
      logout: async () => {
        await request('/api/auth/logout', { method: 'POST' });
        setState({ status: 'anonymous' });
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
