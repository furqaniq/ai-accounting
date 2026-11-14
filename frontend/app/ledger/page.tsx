'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  Account,
  AccountRegister,
  ActiveOrganization,
  JournalEntry,
  JournalLineInput,
  JournalSourceType,
  clearSession,
  createJournalEntry,
  fetchAccounts,
  fetchActiveOrganization,
  fetchJournalEntries,
  fetchJournalEntry,
  fetchRegister,
  getAccessToken,
  getActiveOrgId,
  reverseJournalEntry,
  setActiveOrgId,
} from '@/lib/api';

const SOURCE_LABELS: Record<JournalSourceType, string> = {
  MANUAL: 'Manual entry',
  INVOICE: 'Invoice',
  BILL: 'Bill',
  EXPENSE: 'Expense',
  PAYMENT: 'Payment',
  BANK: 'Bank transaction',
  REVERSAL: 'Reversal',
};

interface DraftLine {
  key: number;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

let nextLineKey = 1;

function blankLine(): DraftLine {
  return { key: nextLineKey++, accountId: '', description: '', debit: '', credit: '' };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function canPost(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

export default function LedgerPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [register, setRegister] = useState<AccountRegister | null>(null);
  const [registerAccountId, setRegisterAccountId] = useState('');
  const [registerFrom, setRegisterFrom] = useState('');
  const [registerTo, setRegisterTo] = useState('');
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
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
      const chart = await fetchAccounts(activeOrg.organizationId);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setAccounts(chart);
      const preferred =
        chart.find((account) => account.code === '1000' && account.active) ??
        chart.find((account) => account.active) ??
        chart[0];
      setRegisterAccountId(preferred?.id ?? '');
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

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.active),
    [accounts],
  );

  const loadEntries = useCallback(async () => {
    if (!org) return;
    try {
      setEntries(await fetchJournalEntries(org.organizationId, { limit: 100 }));
      setError(null);
    } catch {
      setError('The journal is not available right now.');
    }
  }, [org]);

  const loadRegister = useCallback(async () => {
    if (!org || !registerAccountId) return;
    try {
      setRegister(
        await fetchRegister(org.organizationId, registerAccountId, {
          from: registerFrom || undefined,
          to: registerTo || undefined,
        }),
      );
    } catch {
      setRegister(null);
    }
  }, [org, registerAccountId, registerFrom, registerTo]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setFormOpen(false);
      setDetailOpen(false);
      setConfirmReverse(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    void loadRegister();
  }, [loadRegister]);

  function openForm() {
    setEntryDate(today());
    setMemo('');
    setLines([blankLine(), blankLine()]);
    setFormError(null);
    setFormOpen(true);
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function setDebit(key: number, value: string) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, debit: value, ...(value.trim() ? { credit: '' } : {}) } : line,
      ),
    );
  }

  function setCredit(key: number, value: string) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, credit: value, ...(value.trim() ? { debit: '' } : {}) } : line,
      ),
    );
  }

  function addLine() {
    setLines((current) => [...current, blankLine()]);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length <= 2 ? current : current.filter((l) => l.key !== key)));
  }

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + parseAmount(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + parseAmount(line.credit), 0);
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
    };
  }, [lines]);

  const balanced = totals.debit > 0 && totals.debit === totals.credit;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const payload: JournalLineInput[] = [];
      for (const [index, line] of lines.entries()) {
        if (!line.accountId) {
          throw new Error(`Line ${index + 1} needs an account`);
        }
        const debit = parseAmount(line.debit);
        const credit = parseAmount(line.credit);
        if ((debit > 0) === (credit > 0)) {
          throw new Error(`Line ${index + 1} needs a debit or a credit`);
        }
        payload.push({
          accountId: line.accountId,
          ...(line.description.trim() ? { description: line.description.trim() } : {}),
          ...(debit > 0 ? { debit } : { credit }),
        });
      }
      const entry = await createJournalEntry(org.organizationId, {
        date: entryDate,
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        lines: payload,
      });
      setFormOpen(false);
      showToast(`${entry.reference} posted to the ledger.`);
      await Promise.all([loadEntries(), loadRegister()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not post that entry');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(entry: JournalEntry) {
    setDetail(entry);
    setConfirmReverse(false);
    setDetailOpen(true);
  }

  async function openDetailById(id: string) {
    if (!org) return;
    try {
      await openDetail(await fetchJournalEntry(org.organizationId, id));
    } catch {
      setError('That entry could not be opened.');
    }
  }

  async function reverseSelected() {
    if (!org || !detail || busy) return;
    if (!confirmReverse) {
      setConfirmReverse(true);
      return;
    }
    setBusy(true);
    try {
      const reversal = await reverseJournalEntry(org.organizationId, detail.id);
      setDetailOpen(false);
      setDetail(null);
      setConfirmReverse(false);
      showToast(`${reversal.reference} reversed ${detail.reference}.`);
      await Promise.all([loadEntries(), loadRegister()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reverse that entry');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the ledger…</p>
      </main>
    );
  }

  const editable = canPost(org?.role ?? '');
  const registerAccounts = accounts;

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
            <a className="nav__item" href="/accounts">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M4 9h16M4 14h16M9 9v11" />
              </svg>
              Accounts
            </a>
            <a className="nav__item is-active" href="/ledger" aria-current="page">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
              Journal
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
            <button
              className="spine-signout"
              type="button"
              onClick={() => {
                clearSession();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>General ledger</h1>
              <p className="page-head__meta">
                {org?.organizationName}. {entries?.length ?? 0} journal entries, posted in balance.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openForm}>
                  New entry
                </button>
              </div>
            ) : null}
          </header>

          <section className="section" aria-labelledby="journal-title">
            <div className="section__head">
              <h2 className="section__title" id="journal-title">
                Journal entries
              </h2>
              <p className="section__meta">Newest first. Open an entry to see its lines or reverse it.</p>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-wrap">
              <table className="data-table journal-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Memo</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries === null ? (
                    <tr>
                      <td colSpan={6} className="journal-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="journal-empty">
                        No entries yet.
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => {
                      const amount = entry.lines.reduce((sum, line) => sum + line.debit, 0);
                      const reversed = Boolean(entry.reversedById);
                      return (
                        <tr
                          key={entry.id}
                          className={`is-clickable${reversed ? ' is-reversed' : ''}`}
                          onClick={() => void openDetail(entry)}
                        >
                          <td>{displayDate(entry.date)}</td>
                          <td className="journal-ref">{entry.reference}</td>
                          <td>{entry.memo ?? '—'}</td>
                          <td className="journal-source">{SOURCE_LABELS[entry.sourceType]}</td>
                          <td className="num journal-amount">{money(amount)}</td>
                          <td>
                            <span
                              className={`status ${
                                reversed
                                  ? 'status--overdue'
                                  : entry.sourceType === 'REVERSAL'
                                    ? 'status--amber'
                                    : 'status--green'
                              }`}
                            >
                              <span className="dot"></span>
                              {reversed
                                ? 'Reversed'
                                : entry.sourceType === 'REVERSAL'
                                  ? 'Reversal'
                                  : 'Posted'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <p className="journal-note">
              Posted entries are never edited in place. Corrections are posted as reversals.
            </p>
          </section>

          <section className="section" aria-labelledby="register-title">
            <div className="register-head">
              <h2 id="register-title">Account register</h2>
              <div className="register-balance">
                <span>
                  Opening
                  <strong>{money(register?.openingBalance ?? 0)}</strong>
                </span>
                <span>
                  Closing
                  <strong>{money(register?.closingBalance ?? 0)}</strong>
                </span>
              </div>
            </div>

            <div className="journal-toolbar">
              <label className="field">
                Register account
                <select
                  aria-label="Register account"
                  value={registerAccountId}
                  onChange={(event) => setRegisterAccountId(event.target.value)}
                >
                  {registerAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                From
                <input
                  type="date"
                  aria-label="Register from"
                  value={registerFrom}
                  onChange={(event) => setRegisterFrom(event.target.value)}
                />
              </label>
              <label className="field">
                To
                <input
                  type="date"
                  aria-label="Register to"
                  value={registerTo}
                  onChange={(event) => setRegisterTo(event.target.value)}
                />
              </label>
            </div>

            <div className="table-wrap">
              <table className="data-table register-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="num">
                      Debit
                    </th>
                    <th scope="col" className="num">
                      Credit
                    </th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!register || register.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="journal-empty">
                        No posted lines in this period.
                      </td>
                    </tr>
                  ) : (
                    register.lines.map((line) => (
                      <tr
                        key={line.id}
                        className="is-clickable"
                        onClick={() => void openDetailById(line.entryId)}
                      >
                        <td>{displayDate(line.date)}</td>
                        <td className="journal-ref">{line.reference}</td>
                        <td>{line.description ?? line.memo ?? '—'}</td>
                        <td className="num journal-amount">
                          {line.debit > 0 ? money(line.debit) : '—'}
                        </td>
                        <td className="num journal-amount">
                          {line.credit > 0 ? money(line.credit) : '—'}
                        </td>
                        <td className="num journal-amount">{money(line.runningBalance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {register && register.lines.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Period totals</td>
                      <td className="num">{money(register.totalDebit)}</td>
                      <td className="num">{money(register.totalCredit)}</td>
                      <td className="num">{money(register.closingBalance)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="journal-form"
        aria-label="New journal entry"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 4h16v16H4z" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
          </span>
          <h2 className="margin__title">New journal entry</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close journal form"
            onClick={() => setFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {formError ? (
          <p className="members__error" role="alert">
            {formError}
          </p>
        ) : null}

        <form className="drawer-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="drawer-form__label" htmlFor="entry-date">
            Entry date
          </label>
          <input
            id="entry-date"
            type="date"
            required
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="entry-memo">
            Memo
          </label>
          <input
            id="entry-memo"
            value={memo}
            placeholder="What this entry records"
            onChange={(event) => setMemo(event.target.value)}
          />

          <div className="journal-form__lines">
            {lines.map((line, index) => (
              <div className="journal-form__line" key={line.key}>
                <span className="line-account">
                  <label htmlFor={`line-${line.key}-account`}>Account</label>
                  <select
                    id={`line-${line.key}-account`}
                    aria-label={`Line ${index + 1} account`}
                    value={line.accountId}
                    onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                  >
                    <option value="">Select account</option>
                    {activeAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} — {account.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="line-desc">
                  <label htmlFor={`line-${line.key}-description`}>Description</label>
                  <input
                    id={`line-${line.key}-description`}
                    aria-label={`Line ${index + 1} description`}
                    value={line.description}
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                  />
                </span>
                <span className="line-debit">
                  <label htmlFor={`line-${line.key}-debit`}>Debit</label>
                  <input
                    id={`line-${line.key}-debit`}
                    aria-label={`Line ${index + 1} debit`}
                    inputMode="decimal"
                    value={line.debit}
                    onChange={(event) => setDebit(line.key, event.target.value)}
                  />
                </span>
                <span className="line-credit">
                  <label htmlFor={`line-${line.key}-credit`}>Credit</label>
                  <input
                    id={`line-${line.key}-credit`}
                    aria-label={`Line ${index + 1} credit`}
                    inputMode="decimal"
                    value={line.credit}
                    onChange={(event) => setCredit(line.key, event.target.value)}
                  />
                </span>
                <button
                  className="journal-form__remove"
                  type="button"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length <= 2}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button className="btn btn--ghost btn--sm journal-form__add" type="button" onClick={addLine}>
            Add line
          </button>

          <div className="journal-totals">
            <div className="journal-totals__row">
              <span>Debits</span>
              <strong>{money(totals.debit)}</strong>
            </div>
            <div className="journal-totals__row">
              <span>Credits</span>
              <strong>{money(totals.credit)}</strong>
            </div>
            <p
              className={`journal-totals__status ${
                balanced ? 'is-balanced' : 'is-unbalanced'
              }`}
            >
              {balanced
                ? 'Balanced — ready to post.'
                : `Out of balance by ${money(Math.abs(totals.debit - totals.credit))}`}
            </p>
          </div>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={!balanced || busy}>
              Post entry
            </button>
            <span className="drawer-form__hint">
              Debits and credits must match before the ledger accepts the entry.
            </span>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${detailOpen ? ' is-open' : ''}`}
        id="entry-detail"
        aria-label="Journal entry detail"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 4h16v16H4z" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
          </span>
          <h2 className="margin__title">{detail?.reference ?? 'Journal entry'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close entry detail"
            onClick={() => setDetailOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {detail ? (
          <>
            <div className="entry-meta">
              <span>
                Date <strong>{displayDate(detail.date)}</strong>
              </span>
              <span>
                Source <strong>{SOURCE_LABELS[detail.sourceType]}</strong>
              </span>
              {detail.reversedByReference ? (
                <span>
                  Reversed by <strong>{detail.reversedByReference}</strong>
                </span>
              ) : null}
              {detail.reversalOfReference ? (
                <span>
                  Reverses <strong>{detail.reversalOfReference}</strong>
                </span>
              ) : null}
            </div>
            {detail.memo ? <p className="entry-meta">Memo <strong>{detail.memo}</strong></p> : null}

            <table className="entry-lines">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="num">
                    Debit
                  </th>
                  <th scope="col" className="num">
                    Credit
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.account.code} — {line.account.name}
                    </td>
                    <td>{line.description ?? '—'}</td>
                    <td className="num">{line.debit > 0 ? money(line.debit) : '—'}</td>
                    <td className="num">{line.credit > 0 ? money(line.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="entry-actions">
              {editable && !detail.reversedById && detail.sourceType !== 'REVERSAL' ? (
                <button
                  className={`btn btn--sm ${confirmReverse ? 'btn--danger' : 'btn--outline'}`}
                  type="button"
                  onClick={() => void reverseSelected()}
                  disabled={busy}
                >
                  {confirmReverse ? 'Confirm reversal' : 'Reverse entry'}
                </button>
              ) : null}
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => setDetailOpen(false)}
              >
                Close
              </button>
              {confirmReverse ? (
                <span className="drawer-form__hint">
                  Reversing posts a mirror entry and keeps the original visible.
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>

      <div
        className={`scrim${formOpen || detailOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => {
          setFormOpen(false);
          setDetailOpen(false);
          setConfirmReverse(false);
        }}
      ></div>
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
