import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useAuth } from '../../app/AuthProvider';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authpage">
      <div className="authpage__intro">
        <span className="brand brand--big">
          <span className="brand__mark" aria-hidden />
          <span className="brand__word">WEEKLY</span>
        </span>
        <h1 className="display authpage__headline">
          Spend less than
          <br />
          you planned.
        </h1>
        <p className="lede">A weekly allowance that carries forward, kept in your own account.</p>
      </div>

      <form className="authpage__card stack stack--lg" onSubmit={submit} noValidate>
        <div className="seg" role="radiogroup" aria-label="Sign in or create an account">
          {(['login', 'register'] as const).map((m) => (
            <label key={m} className={`seg__opt${mode === m ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setError('');
                }}
              />
              {m === 'login' ? 'Sign in' : 'Create account'}
            </label>
          ))}
        </div>

        {mode === 'register' && (
          <div className="field">
            <label className="label" htmlFor="auth-name">
              Name
            </label>
            <input id="auth-name" className="input" autoComplete="name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            className="input"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            className="input"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && <p className="hint">At least 10 characters.</p>}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
