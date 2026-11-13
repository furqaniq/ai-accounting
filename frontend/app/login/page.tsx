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
    <main className="login-page">
      <section className="login-block">
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect className="mark-paper" x="4.5" y="3" width="23" height="26" rx="1" />
            <path className="mark-rule" d="M9 9h14M9 14h14M9 19h9" />
            <path className="mark-margin" d="M12 3v26" />
          </svg>
          <span>
            <span className="brand__name">Daybook</span>
            <span className="brand__sub">AI accounting</span>
          </span>
        </div>
        <h1>Sign in</h1>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-hint">Demo: owner@acme.test · Passw0rd!2026</p>
      </section>
    </main>
  );
}
