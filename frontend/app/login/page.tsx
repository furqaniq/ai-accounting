'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, REFRESH_TOKEN_KEY, TOKEN_KEY } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError('Invalid email or password.');
        return;
      }
      const data = await res.json();
      window.localStorage.setItem(TOKEN_KEY, data.accessToken);
      window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      router.push('/');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-ledger" aria-hidden="true">
        <div className="login-brand">
          <img className="login-logo" src="/icon.svg" width={38} height={38} alt="" />
          <span>
            <span className="brand__name">Daybook</span>
            <span className="brand__sub">AI accounting</span>
          </span>
        </div>

        <div className="login-statement">
          <p className="login-kicker">Open books</p>
          <h2>Every entry, in its place.</h2>
          <p>
            Sign in to your ledger — invoices, bills, reconciliation and Clerk,
            the agent that keeps the page tidy.
          </p>
        </div>

        <div className="login-excerpt">
          <p className="login-excerpt__kicker">Today&apos;s page — 13 Nov</p>
          <div className="login-excerpt__row">
            <span>Opening balance</span>
            <span>84,290.16</span>
          </div>
          <div className="login-excerpt__row">
            <span>Entries posted</span>
            <span>14</span>
          </div>
          <div className="login-excerpt__row">
            <span>Reconciled to date</span>
            <span>100%</span>
          </div>
          <div className="login-excerpt__total">
            <span>Balance c/d</span>
            <span>84,290.16</span>
          </div>
        </div>

        <p className="login-ledger__foot">
          Local demo · synthetic data only
        </p>
      </section>

      <section className="login-form-pane">
        <div className="login-form">
          <p className="login-welcome">Welcome back</p>
          <h1>Sign in</h1>
          <p className="login-lede">
            Open the ledger to your organization&apos;s books.
          </p>

          <form onSubmit={submit}>
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="owner@acme.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="login-note">
            <span className="login-note__demo">Demo entry</span> —{' '}
            <strong>owner@acme.test</strong> · <strong>Passw0rd!2026</strong>
          </p>
          <p className="login-foot">Daybook · local demo build</p>
        </div>
      </section>
    </main>
  );
}
