'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  Account,
  ActiveOrganization,
  clearSession,
  fetchActiveOrganization,
  fetchAccounts,
  createAccount,
  updateAccount,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
} from '@/lib/api';

const TYPE_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

const TYPE_OPTIONS = [
  ['ASSET', 'Asset'],
  ['LIABILITY', 'Liability'],
  ['EQUITY', 'Equity'],
  ['INCOME', 'Income'],
  ['EXPENSE', 'Expense'],
] as const;

const SUBTYPES = [
  'Current asset',
  'Accounts receivable',
  'Fixed asset',
  'Accounts payable',
  'Current liability',
  'Long-term liability',
  'Equity',
  'Income',
  'Other income',
  'Operating expense',
  'General expense',
];

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

export default function AccountsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('ASSET');
  const [subtype, setSubtype] = useState('Current asset');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      const me = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!me.ok) throw new Error('unauthorized');
      const session = (await me.json()) as {
        memberships: { organizationId: string; organizationName: string; role: string }[];
      };
      const stored = getActiveOrgId();
      const initial =
        session.memberships.find((m) => m.organizationId === stored) ?? session.memberships[0];
      if (!initial) throw new Error('no organization');
      const activeOrg = await fetchActiveOrganization(initial.organizationId);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setReady(true);
    })().catch(() => {
      if (cancelled) return;
      clearSession();
      router.replace('/login');
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      setAccounts(await fetchAccounts(org.organizationId));
      setError(null);
    } catch {
      setError('The chart of accounts is not available right now.');
    }
  }, [org]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setCode('');
    setName('');
    setType('ASSET');
    setSubtype('Current asset');
    setActive(true);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(account: Account) {
    setEditing(account);
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setSubtype(account.subtype ?? '');
    setActive(account.active);
    setError(null);
    setFormOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    setBusy(true);
    setError(null);
    try {
      const base = {
        code: code.trim(),
        name: name.trim(),
        type,
        subtype: subtype || undefined,
      };
      if (editing) {
        await updateAccount(org.organizationId, editing.id, { ...base, active });
        showToast(`${base.name} updated.`);
      } else {
        await createAccount(org.organizationId, base);
        showToast(`${base.name} added to the chart.`);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that account');
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => {
    if (!accounts) return null;
    return accounts.filter(
      (account) =>
        (typeFilter === '' || account.type === typeFilter) &&
        (showInactive || account.active),
    );
  }, [accounts, typeFilter, showInactive]);

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the ledger…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');
  const activeCount = accounts?.filter((account) => account.active).length ?? 0;

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <aside className="spine" id="spine">
          <a className="brand" href="/">
            <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect className="mark-paper" x="4.5" y="3" width="23" height="26" rx="1" />
              <path className="mark-rule" d="M9 9h14M9 14h14M9 19h9" />
              <path className="mark-margin" d="M12 3v26" />
            </svg>
            <span>
              <span className="brand__name">Daybook</span>
              <span className="brand__sub">AI accounting</span>
            </span>
          </a>

          <a className="org__button" href="/">
            <span>
              <span className="org__name">{org?.organizationName}</span>
              <span className="org__meta">
                {(org?.role ?? '').charAt(0) + (org?.role ?? '').slice(1).toLowerCase()}
              </span>
            </span>
          </a>

          <nav className="nav" aria-label="Primary">
            <a className="nav__item" href="/">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Overview
            </a>
            <a className="nav__item is-active" href="/accounts" aria-current="page">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M4 9h16M4 14h16M9 9v11" />
              </svg>
              Accounts
            </a>
            <a className="nav__item" href="/" aria-label="Invoices, coming soon">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                <path d="M14 3v6h6M8 13h8M8 17h5" />
              </svg>
              Invoices
            </a>
            <a className="nav__item" href="/" aria-label="Banking, coming soon">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
              </svg>
              Banking
            </a>
            <a className="nav__item" href="/" aria-label="Reports, coming soon">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
              Reports
            </a>
          </nav>

          <div className="spine__foot">
            <span className="spine__label">Signed in</span>
            <button className="spine-signout" type="button" onClick={() => {
              clearSession();
              router.replace('/login');
            }}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Chart of accounts</h1>
              <p className="page-head__meta">
                {org?.organizationName}. {accounts?.length ?? 0} accounts, {activeCount} active.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New account
                </button>
              </div>
            ) : null}
          </header>

          <section className="section" aria-labelledby="chart-title">
            <div className="accounts-toolbar">
              <div className="range" aria-label="Filter by account type">
                <button
                  type="button"
                  aria-pressed={typeFilter === ''}
                  onClick={() => setTypeFilter('')}
                >
                  All
                </button>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={typeFilter === value}
                    onClick={() => setTypeFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="accounts-toggle">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show inactive
              </label>
            </div>

            <h2 className="sr-only" id="chart-title">
              Accounts
            </h2>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-wrap">
              <table className="data-table accounts-table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Account</th>
                    <th scope="col">Type</th>
                    <th scope="col">Subtype</th>
                    <th scope="col">Status</th>
                    {editable ? <th scope="col" className="sr-only">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible === null ? (
                    <tr>
                      <td colSpan={editable ? 6 : 5} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : visible.length === 0 ? (
                    <tr>
                      <td colSpan={editable ? 6 : 5} className="accounts-empty">
                        No accounts in this view.
                      </td>
                    </tr>
                  ) : (
                    visible.map((account) => (
                      <tr key={account.id} className={account.active ? undefined : 'is-inactive'}>
                        <td className="accounts-code">{account.code}</td>
                        <td>{account.name}</td>
                        <td>{TYPE_LABELS[account.type] ?? account.type}</td>
                        <td>{account.subtype ?? '—'}</td>
                        <td>
                          <span className={`status ${account.active ? 'status--green' : 'status--amber'}`}>
                            <span className="dot"></span>
                            {account.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {editable ? (
                          <td className="num">
                            <button
                              className="btn btn--ghost btn--sm"
                              type="button"
                              aria-label={`Edit ${account.name}`}
                              onClick={() => openEdit(account)}
                            >
                              Edit
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="accounts-note">
              Deactivated accounts stay in past entries and reports; they only leave new-entry
              pickers.
            </p>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="account-form"
        aria-label={editing ? 'Edit account' : 'New account'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 4h16v16H4z" />
              <path d="M4 9h16M4 14h16M9 9v11" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit account' : 'New account'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close account form"
            onClick={() => setFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error ? (
          <p className="members__error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="drawer-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="drawer-form__label" htmlFor="account-code">
            Code
          </label>
          <input
            id="account-code"
            required
            inputMode="numeric"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="account-name">
            Name
          </label>
          <input
            id="account-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="account-type">
            Type
          </label>
          <select
            id="account-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="account-subtype">
            Subtype
          </label>
          <select
            id="account-subtype"
            value={subtype}
            onChange={(event) => setSubtype(event.target.value)}
          >
            <option value="">None</option>
            {SUBTYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {editing ? (
            <label className="accounts-toggle accounts-toggle--drawer">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Account is active
            </label>
          ) : null}

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editing ? 'Save account' : 'Add account'}
            </button>
            <span className="drawer-form__hint">
              Codes must be unique in this book. Accounts are never deleted.
            </span>
          </div>
        </form>
      </aside>

      <div
        className={`scrim${formOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => setFormOpen(false)}
      ></div>
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
