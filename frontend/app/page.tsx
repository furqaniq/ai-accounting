'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  REFRESH_TOKEN_KEY,
  SessionUser,
  TOKEN_KEY,
  clearSession,
  getAccessToken,
} from '@/lib/api';

const NAV_ITEMS = ['Overview', 'Invoices', 'Reconcile', 'Reports', 'Agent'];

export default function OverviewPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  const signOut = useCallback(async () => {
    const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error('unauthorized');
        return res.json();
      })
      .then((data: SessionUser) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
          router.replace('/login');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!user) {
    return (
      <main className="login-page">
        <p className="login-hint">Loading…</p>
      </main>
    );
  }

  const org = user.memberships[0];
  const role = org?.role ?? '';

  return (
    <div className="shell">
      <aside className="spine">
        <div className="wordmark">Daybook</div>
        <nav aria-label="Main">
          {NAV_ITEMS.map((item, index) => (
            <a
              key={item}
              href={index === 0 ? '/' : `#${item.toLowerCase()}`}
              aria-current={index === 0 ? 'page' : undefined}
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="spine-foot">
          <span>{user.email}</span>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="page-head">
          <h1>
            Overview
            <span className="role-pill">{role.toLowerCase()}</span>
          </h1>
          <span className="org">{org?.organizationName ?? ''}</span>
        </header>

        <div className="ruled">
          <div className="ruled-row">
            <span className="label">Signed in as</span>
            <span className="value">{user.name}</span>
          </div>
          <div className="ruled-row">
            <span className="label">Cash position</span>
            <span className="value">Arrives with banking</span>
          </div>
          <div className="ruled-row">
            <span className="label">Receivables</span>
            <span className="value">Arrives with invoices</span>
          </div>
          <div className="ruled-row">
            <span className="label">Payables</span>
            <span className="value">Arrives with bills</span>
          </div>
        </div>

        <p className="note">
          The walking skeleton is signed in. Books, reports, and the Clerk arrive as
          their slices land.
        </p>
      </main>

      <aside className="clerk">
        <div className="clerk-head">Clerk</div>
        <p className="clerk-note">
          The agent workspace opens with the agent slices — prompt, scheduled
          routines, and event triggers, all behind one tool registry.
        </p>
      </aside>
    </div>
  );
}
