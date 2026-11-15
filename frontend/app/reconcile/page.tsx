'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  BankAccount,
  ReconciliationDetail,
  ReconciliationSession,
  clearSession,
  completeReconciliation,
  createReconciliation,
  fetchActiveOrganization,
  fetchBankAccounts,
  fetchReconciliation,
  fetchReconciliations,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  setReconciliationCleared,
  undoReconciliation,
} from '@/lib/api';

interface SessionForm {
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  statementEndingBalance: string;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedMoney(value: number): string {
  return value < 0 ? `-${money(Math.abs(value))}` : money(value);
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function displayPeriod(start: string, end: string): string {
  return `${displayDate(start)} – ${displayDate(end)}`;
}

function displayStamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function monthEnd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export default function ReconcilePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [sessions, setSessions] = useState<ReconciliationSession[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearBusyId, setClearBusyId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<SessionForm>({
    bankAccountId: '',
    periodStart: monthStart(),
    periodEnd: monthEnd(),
    statementEndingBalance: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3600);
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
      const [accountRows, sessionRows] = await Promise.all([
        fetchBankAccounts(activeOrg.organizationId),
        fetchReconciliations(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setAccounts(accountRows);
      setSessions(sessionRows);
      const requested =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('session')
          : null;
      const nextId =
        requested && sessionRows.some((row) => row.id === requested)
          ? requested
          : sessionRows[0]?.id ?? null;
      setSelectedId(nextId);
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

  const refreshSessions = useCallback(async () => {
    if (!org) return [];
    const rows = await fetchReconciliations(org.organizationId);
    setSessions(rows);
    return rows;
  }, [org]);

  useEffect(() => {
    if (!org || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchReconciliation(org.organizationId, selectedId)
      .then((row) => {
        if (cancelled) return;
        setDetail(row);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : 'That reconciliation is not available');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setFormOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function selectSession(id: string) {
    setSelectedId(id);
    setDetail(null);
    setError(null);
    router.replace(`/reconcile?session=${id}`);
  }

  function openForm() {
    setForm({
      bankAccountId: accounts?.[0]?.id ?? '',
      periodStart: monthStart(),
      periodEnd: monthEnd(),
      statementEndingBalance: '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setFormField<K extends keyof SessionForm>(field: K, value: SessionForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || formBusy) return;
    if (!form.bankAccountId) {
      setFormError('Choose the bank account you are reconciling.');
      return;
    }
    if (!form.periodStart || !form.periodEnd) {
      setFormError('Choose the start and end of the statement period.');
      return;
    }
    if (form.periodStart > form.periodEnd) {
      setFormError('The period start must be on or before the period end.');
      return;
    }
    const statement = Number(form.statementEndingBalance);
    if (
      !form.statementEndingBalance.trim() ||
      !Number.isFinite(statement) ||
      Math.abs(Math.round(statement * 100) - statement * 100) > 0.0001
    ) {
      setFormError('Enter the statement ending balance with at most two decimals.');
      return;
    }

    setFormBusy(true);
    setFormError(null);
    try {
      const saved = await createReconciliation(org.organizationId, {
        bankAccountId: form.bankAccountId,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        statementEndingBalance: statement,
      });
      setFormOpen(false);
      await refreshSessions();
      selectSession(saved.id);
      setDetail(saved);
      showToast(`Reconciliation started for ${saved.bankAccount.name}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not start that reconciliation');
    } finally {
      setFormBusy(false);
    }
  }

  async function toggleCleared(transactionId: string, cleared: boolean) {
    if (!org || !detail || clearBusyId) return;
    setClearBusyId(transactionId);
    setError(null);
    try {
      const updated = await setReconciliationCleared(
        org.organizationId,
        detail.id,
        transactionId,
        cleared,
      );
      setDetail(updated);
      setSessions((current) =>
        (current ?? []).map((row) =>
          row.id === updated.id
            ? {
                ...row,
                clearedTotal: updated.clearedTotal,
                clearedBalance: updated.clearedBalance,
                bookBalance: updated.bookBalance,
                difference: updated.difference,
                balanced: updated.balanced,
                updatedAt: updated.updatedAt,
              }
            : row,
        ),
      );
      showToast(cleared ? 'Transaction marked cleared.' : 'Transaction marked outstanding.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that clearance');
    } finally {
      setClearBusyId(null);
    }
  }

  function applySession(updated: ReconciliationDetail) {
    setDetail(updated);
    setSessions((current) =>
      (current ?? []).map((row) => (row.id === updated.id ? updated : row)),
    );
  }

  async function completeSession() {
    if (!org || !detail || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      const updated = await completeReconciliation(org.organizationId, detail.id);
      applySession(updated);
      showToast('Reconciliation completed and locked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete that reconciliation');
    } finally {
      setActionBusy(false);
    }
  }

  async function undoSession() {
    if (!org || !detail || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      const updated = await undoReconciliation(org.organizationId, detail.id);
      applySession(updated);
      showToast('Reconciliation undone and editable again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo that reconciliation');
    } finally {
      setActionBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the reconciliation book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');
  const selectedSummary = detail ?? sessions?.find((row) => row.id === selectedId) ?? null;
  const accountName =
    detail?.bankAccount.name ??
    accounts?.find((account) => account.id === detail?.bankAccountId)?.name ??
    '';

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="reconcile" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Reconciliation</h1>
              <p className="page-head__meta">
                {accounts?.length ?? 0} bank {accounts?.length === 1 ? 'account' : 'accounts'}.
                {' '}
                {selectedSummary
                  ? `${selectedSummary.bankAccount.name} · ${displayPeriod(
                      selectedSummary.periodStart,
                      selectedSummary.periodEnd,
                    )}.`
                  : 'Start a session to prove the statement against the books.'}
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={openForm}
                  disabled={!accounts || accounts.length === 0}
                >
                  New session
                </button>
              </div>
            ) : null}
          </header>

          {error ? (
            <p className="members__error" role="alert">
              {error}
            </p>
          ) : null}

          {selectedSummary ? (
            <section className="reconcile-summary" aria-label="Reconciliation balances">
              <div className="reconcile-summary__item">
                <span className="reconcile-summary__label">Statement balance</span>
                <strong className="reconcile-summary__value">
                  {money(selectedSummary.statementEndingBalance)}
                </strong>
              </div>
              <div className="reconcile-summary__item">
                <span className="reconcile-summary__label">Cleared total</span>
                <strong className="reconcile-summary__value">
                  {signedMoney(selectedSummary.clearedTotal)}
                </strong>
              </div>
              <div className="reconcile-summary__item">
                <span className="reconcile-summary__label">Book balance</span>
                <strong className="reconcile-summary__value">
                  {money(selectedSummary.bookBalance)}
                </strong>
              </div>
              <div className="reconcile-summary__item">
                <span className="reconcile-summary__label">Difference</span>
                <strong
                  className={`reconcile-summary__value reconcile-summary__difference${
                    selectedSummary.balanced ? ' is-balanced' : ''
                  }`}
                >
                  {signedMoney(selectedSummary.difference)}
                </strong>
              </div>
            </section>
          ) : null}

          <section className="reconcile-sessions" aria-labelledby="reconcile-sessions-title">
            <div className="section-head">
              <div>
                <h2 id="reconcile-sessions-title">Sessions</h2>
                <p className="section__meta">
                  Resume a saved reconciliation, or start a new statement period.
                </p>
              </div>
            </div>

            <div className="table-scroll">
              <table className="data-table reconcile-session-table">
                <caption className="sr-only">Saved reconciliation sessions</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Period</th>
                    <th scope="col" className="num">
                      Statement
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions === null ? (
                    <tr>
                      <td colSpan={5} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : sessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="accounts-empty">
                        No reconciliation sessions yet. Start one with a statement ending balance.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((row) => (
                      <tr
                        key={row.id}
                        className={`reconcile-session-row${
                          row.id === selectedId ? ' is-selected' : ''
                        }`}
                      >
                        <td>{row.bankAccount.name}</td>
                        <td>{displayPeriod(row.periodStart, row.periodEnd)}</td>
                        <td className="num">{money(row.statementEndingBalance)}</td>
                        <td>
                          <span
                            className={`status ${
                              row.status === 'COMPLETED' ? 'status--paid' : 'status--sent'
                            }`}
                          >
                            <span className="dot"></span>
                            {row.status === 'COMPLETED' ? 'Completed' : 'Active'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn--outline btn--sm"
                            type="button"
                            onClick={() => selectSession(row.id)}
                          >
                            {row.status === 'COMPLETED'
                              ? 'Review'
                              : row.id === selectedId
                                ? 'Open'
                                : 'Resume'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {detailLoading ? (
            <p className="app-loading__hint">Reading the statement…</p>
          ) : detail ? (
            <section className="reconcile-workbench" aria-labelledby="reconcile-workbench-title">
              <div className="section-head">
                <div>
                  <h2 id="reconcile-workbench-title">Transactions</h2>
                  <p className="section__meta">
                    {accountName} · {detail.clearedCount} of {detail.transactionCount} cleared.
                    {' '}
                    {detail.status === 'COMPLETED' && detail.completedAt
                      ? `Completed ${displayStamp(detail.completedAt)}.`
                      : 'Unmarked items stay outstanding.'}
                  </p>
                </div>
                <div className="reconcile-workbench__actions">
                  <span className="reconcile-period">
                    {displayPeriod(detail.periodStart, detail.periodEnd)}
                  </span>
                  {editable && detail.status === 'ACTIVE' ? (
                    <button
                      className="btn btn--primary btn--sm"
                      type="button"
                      onClick={() => void completeSession()}
                      disabled={actionBusy || !detail.balanced}
                      title={
                        detail.balanced
                          ? 'Lock this balanced reconciliation as complete'
                          : 'Resolve the difference before completing'
                      }
                    >
                      {actionBusy ? 'Completing…' : 'Complete reconciliation'}
                    </button>
                  ) : null}
                  {editable && detail.status === 'COMPLETED' ? (
                    <button
                      className="btn btn--outline btn--sm"
                      type="button"
                      onClick={() => void undoSession()}
                      disabled={actionBusy}
                    >
                      {actionBusy ? 'Undoing…' : 'Undo reconciliation'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="table-scroll">
                <table className="data-table reconcile-transaction-table">
                  <caption className="sr-only">
                    Imported transactions in the reconciliation period
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col">Match</th>
                      <th scope="col">Cleared</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="accounts-empty">
                          No imported transactions fall in this period.
                        </td>
                      </tr>
                    ) : (
                      detail.transactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{displayDate(transaction.date)}</td>
                          <td>{transaction.description}</td>
                          <td
                            className={`num${
                              transaction.amount < 0 ? ' bank-amount-out' : ''
                            }`}
                          >
                            {signedMoney(transaction.amount)}
                          </td>
                          <td className="bank-category-cell">
                            {transaction.resolutionLabel ? (
                              <span>{transaction.resolutionLabel}</span>
                            ) : transaction.categoryAccount ? (
                              <span>
                                {transaction.categoryAccount.code} ·{' '}
                                {transaction.categoryAccount.name}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {transaction.clearedElsewhere ? (
                              <span className="reconcile-cleared-elsewhere">
                                Cleared elsewhere
                              </span>
                            ) : (
                              <label className="reconcile-check">
                                <input
                                  type="checkbox"
                                  checked={transaction.cleared}
                                  disabled={
                                    !editable ||
                                    clearBusyId !== null ||
                                    detail.status !== 'ACTIVE'
                                  }
                                  onChange={(event) =>
                                    void toggleCleared(transaction.id, event.target.checked)
                                  }
                                />
                                <span>
                                  {transaction.cleared ? 'Cleared' : 'Outstanding'}
                                </span>
                              </label>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="reconcile-foot">
                {detail.status === 'COMPLETED'
                  ? 'This reconciliation is complete and locked. Undo it to make changes.'
                  : 'Statement balance less the opening balance and cleared activity is the difference. Marking an item updates it immediately.'}
              </p>
            </section>
          ) : (
            <p className="reconcile-empty">
              Choose a saved session above, or start one from the statement ending balance.
            </p>
          )}
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="reconcile-form"
        aria-label="New reconciliation"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h10M4 17h7" />
              <path d="m15 15 2 2 4-4" />
            </svg>
          </span>
          <h2 className="margin__title">New reconciliation</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close reconciliation form"
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

        <form className="drawer-form" onSubmit={(event) => void onStartSession(event)}>
          <label className="drawer-form__label" htmlFor="reconcile-bank-account">
            Bank account
          </label>
          <select
            id="reconcile-bank-account"
            required
            value={form.bankAccountId}
            onChange={(event) => setFormField('bankAccountId', event.target.value)}
          >
            <option value="">Choose an account</option>
            {(accounts ?? [])
              .filter((account) => account.active)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.ledgerAccount.code}{' '}
                  {account.ledgerAccount.name}
                </option>
              ))}
          </select>

          <div className="reconcile-form-dates">
            <label>
              <span className="drawer-form__label">Period start</span>
              <input
                type="date"
                required
                value={form.periodStart}
                onChange={(event) => setFormField('periodStart', event.target.value)}
              />
            </label>
            <label>
              <span className="drawer-form__label">Period end</span>
              <input
                type="date"
                required
                value={form.periodEnd}
                onChange={(event) => setFormField('periodEnd', event.target.value)}
              />
            </label>
          </div>

          <label className="drawer-form__label" htmlFor="reconcile-statement">
            Statement ending balance
          </label>
          <input
            id="reconcile-statement"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={form.statementEndingBalance}
            onChange={(event) =>
              setFormField('statementEndingBalance', event.target.value)
            }
          />
          <p className="drawer-form__hint">
            Enter the ending balance printed on the bank statement. Opening and book
            balances come from the ledger.
          </p>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={formBusy}>
              {formBusy ? 'Starting…' : 'Start reconciliation'}
            </button>
          </div>
        </form>
      </aside>

      <div
        className={`scrim${formOpen ? ' is-visible' : ''}`}
        aria-hidden={!formOpen}
        onClick={() => setFormOpen(false)}
      ></div>

      <div className="toast-region" role="status" aria-live="polite">
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    </>
  );
}
