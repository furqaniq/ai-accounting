'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, REFRESH_TOKEN_KEY, TOKEN_KEY } from '@/lib/api';

const DEMO_GROUPS = [
  {
    org: 'Acme Services Co.',
    accounts: [
      { email: 'owner@acme.test', role: 'Owner' },
      { email: 'accountant@acme.test', role: 'Accountant' },
      { email: 'staff@acme.test', role: 'Staff' },
      { email: 'viewer@acme.test', role: 'Viewer' },
    ],
  },
  {
    org: 'Nimbus Retail LLC',
    accounts: [
      { email: 'owner@nimbus.test', role: 'Owner' },
      { email: 'accountant@nimbus.test', role: 'Accountant' },
    ],
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  function pickDemo(demoEmail: string) {
    setEmail(demoEmail);
    setError(null);
    passwordRef.current?.focus();
  }

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
      <section className="login-ledger">
        <div className="login-brand" aria-hidden="true">
          <img className="login-logo" src="/icon.svg" width={38} height={38} alt="" />
          <span>
            <span className="brand__name">Daybook</span>
            <span className="brand__sub">AI accounting</span>
          </span>
        </div>

        <div className="login-statement" aria-hidden="true">
          <p className="login-kicker">Open books</p>
          <h2>Today&apos;s page is waiting.</h2>
          <p>
            Invoices, bills, and bank reconciliation in one ledger — with
            Clerk, your agent, keeping every entry in its place.
          </p>
        </div>

        <div className="login-demo">
          <p className="login-demo__kicker" id="demo-accounts-label">
            Demo accounts
          </p>
          {DEMO_GROUPS.map((group) => (
            <div key={group.org} className="login-demo__group">
              <p className="login-demo__org">{group.org}</p>
              {group.accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="login-demo__row"
                  onClick={() => pickDemo(account.email)}
                >
                  <span className="login-demo__email">{account.email}</span>
                  <span className="login-demo__role">{account.role}</span>
                </button>
              ))}
            </div>
          ))}
          <p className="login-demo__password">
            Password for all accounts — <strong>Passw0rd!2026</strong>
          </p>
        </div>

        <p className="login-ledger__foot">Local demo · synthetic data only</p>
      </section>

      <section className="login-form-pane">
        <div className="login-form">
          <p className="login-welcome">Welcome back</p>
          <h1>Sign in</h1>
          <p className="login-lede">
            Enter your credentials, or choose a demo account to fill them in.
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
                ref={passwordRef}
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

          <p className="login-foot">Daybook · local demo build</p>
        </div>
      </section>
    </main>
  );
}
