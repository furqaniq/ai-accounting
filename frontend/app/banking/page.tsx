'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  Account,
  AccountType,
  ActiveOrganization,
  BankAccount,
  BankAccountType,
  BankImportMapping,
  BankImportPreview,
  BankImportPreviewRow,
  BankTransaction,
  BankTransactionMatchState,
  clearSession,
  createBankAccount,
  fetchAccounts,
  fetchActiveOrganization,
  fetchBankAccounts,
  fetchBankTransactions,
  getAccessToken,
  getActiveOrgId,
  importBankTransactions,
  previewBankImport,
  setActiveOrgId,
} from '@/lib/api';

const ACCOUNT_TYPES: Array<{ value: BankAccountType; label: string }> = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
];

const MATCH_STATES: Array<{ value: BankTransactionMatchState; label: string }> = [
  { value: 'UNMATCHED', label: 'Unmatched' },
  { value: 'MATCHED', label: 'Matched' },
  { value: 'CATEGORIZED', label: 'Categorized' },
];

const MATCH_CLASS: Record<BankTransactionMatchState, string> = {
  UNMATCHED: 'status--draft',
  MATCHED: 'status--paid',
  CATEGORIZED: 'status--sent',
};

interface AccountForm {
  name: string;
  type: BankAccountType;
  ledgerAccountId: string;
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

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function typeLabel(type: BankAccountType): string {
  return ACCOUNT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

function requiredLedgerType(type: BankAccountType): AccountType {
  return type === 'CREDIT_CARD' ? 'LIABILITY' : 'ASSET';
}

function mappingFromPreview(preview: BankImportPreview): BankImportMapping {
  if (!preview.mapping) return {};
  return {
    dateColumn: preview.mapping.date ?? undefined,
    descriptionColumn: preview.mapping.description ?? undefined,
    amountColumn: preview.mapping.amount ?? undefined,
    debitColumn: preview.mapping.debit ?? undefined,
    creditColumn: preview.mapping.credit ?? undefined,
    externalIdColumn: preview.mapping.externalId ?? undefined,
  };
}

function previewStatus(row: BankImportPreviewRow): string {
  if (!row.valid) return 'Invalid';
  if (row.duplicate) return 'Duplicate';
  return 'New';
}

export default function BankingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[] | null>(null);
  const [matchFilter, setMatchFilter] = useState<'' | BankTransactionMatchState>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountForm>({
    name: '',
    type: 'CHECKING',
    ledgerAccountId: '',
  });
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<BankImportPreview | null>(null);
  const [importMapping, setImportMapping] = useState<BankImportMapping>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

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
      const [accountRows, bankAccountRows] = await Promise.all([
        fetchAccounts(activeOrg.organizationId),
        fetchBankAccounts(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setLedgerAccounts(accountRows);
      setAccounts(bankAccountRows);
      setSelectedId(bankAccountRows[0]?.id ?? null);
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

  const selected = useMemo(
    () => accounts?.find((account) => account.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  const eligibleLedgerAccounts = useMemo(() => {
    const required = requiredLedgerType(accountForm.type);
    return ledgerAccounts.filter((account) => account.active && account.type === required);
  }, [accountForm.type, ledgerAccounts]);

  const loadTransactions = useCallback(async () => {
    if (!org || !selectedId) {
      setTransactions([]);
      return;
    }
    try {
      setTransactions(
        await fetchBankTransactions(org.organizationId, {
          bankAccountId: selectedId,
          from: from || undefined,
          to: to || undefined,
          matchState: matchFilter || undefined,
          search: search.trim() || undefined,
        }),
      );
      setError(null);
    } catch {
      setError('Bank transactions are not available right now.');
    }
  }, [org, selectedId, from, to, matchFilter, search]);

  useEffect(() => {
    if (!org) return;
    if (!selectedId) {
      setTransactions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadTransactions();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadTransactions, org, selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setAccountFormOpen(false);
      setImportOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!org) return;
    const rows = await fetchBankAccounts(org.organizationId);
    setAccounts(rows);
    setSelectedId((current) => {
      if (current && rows.some((row) => row.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [org]);

  function openAccountForm() {
    const required = requiredLedgerType('CHECKING');
    const first = ledgerAccounts.find(
      (account) => account.active && account.type === required,
    );
    setAccountForm({ name: '', type: 'CHECKING', ledgerAccountId: first?.id ?? '' });
    setAccountError(null);
    setAccountFormOpen(true);
  }

  function setAccountType(type: BankAccountType) {
    const required = requiredLedgerType(type);
    setAccountForm((current) => {
      const ledger = ledgerAccounts.find(
        (account) => account.active && account.type === required,
      );
      return {
        ...current,
        type,
        ledgerAccountId:
          ledgerAccounts.find(
            (account) => account.id === current.ledgerAccountId && account.type === required,
          )?.id ?? ledger?.id ?? '',
      };
    });
  }

  async function onAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || accountBusy) return;
    if (!accountForm.name.trim()) {
      setAccountError('Give this account a name.');
      return;
    }
    if (!accountForm.ledgerAccountId) {
      setAccountError('Choose the ledger account it posts to.');
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    try {
      const saved = await createBankAccount(org.organizationId, {
        name: accountForm.name.trim(),
        type: accountForm.type,
        ledgerAccountId: accountForm.ledgerAccountId,
      });
      setAccountFormOpen(false);
      await refreshAccounts();
      setSelectedId(saved.id);
      showToast(`${saved.name} added to the banking workspace.`);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not add that bank account');
    } finally {
      setAccountBusy(false);
    }
  }

  function openImport() {
    setImportFile(null);
    setImportPreview(null);
    setImportMapping({});
    setImportError(null);
    setImportOpen(true);
  }

  function onImportFile(file: File | null) {
    setImportFile(file);
    setImportPreview(null);
    setImportMapping({});
    setImportError(null);
  }

  async function runPreview(mapping = importMapping) {
    if (!org || !selected || !importFile || importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const preview = await previewBankImport(
        org.organizationId,
        selected.id,
        importFile,
        mapping,
      );
      setImportPreview(preview);
      setImportMapping(mappingFromPreview(preview));
    } catch (err) {
      setImportPreview(null);
      setImportError(err instanceof Error ? err.message : 'Could not preview that bank file');
    } finally {
      setImportBusy(false);
    }
  }

  function setMapping(field: keyof BankImportMapping, value: string) {
    setImportMapping((current) => ({ ...current, [field]: value || undefined }));
  }

  async function onConfirmImport() {
    if (!org || !selected || !importFile || !importPreview || importBusy) return;
    if (importPreview.mappingError) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importBankTransactions(
        org.organizationId,
        selected.id,
        importFile,
        importMapping,
      );
      setImportOpen(false);
      await refreshAccounts();
      await loadTransactions();
      const batch = result.batch;
      const parts = [
        `Imported ${batch.importedCount} transaction${batch.importedCount === 1 ? '' : 's'}`,
      ];
      if (batch.duplicateCount > 0) {
        parts.push(
          `${batch.duplicateCount} duplicate${batch.duplicateCount === 1 ? '' : 's'} skipped`,
        );
      }
      if (batch.invalidCount > 0) {
        parts.push(
          `${batch.invalidCount} invalid row${batch.invalidCount === 1 ? '' : 's'} ignored`,
        );
      }
      showToast(`${parts.join('; ')}.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not import that bank file');
    } finally {
      setImportBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the bank book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');
  const rows = transactions ?? [];
  const unmatched = rows.filter((row) => row.matchState === 'UNMATCHED').length;

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="banking" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Banking</h1>
              <p className="page-head__meta">
                {accounts?.length ?? 0} bank {accounts?.length === 1 ? 'account' : 'accounts'}.
                {' '}
                {selected ? `${selected.name} · ${selected.transactionCount} transactions.` : 'Start by adding an account.'}
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--ghost" type="button" onClick={openAccountForm}>
                  New bank account
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={openImport}
                  disabled={!selected}
                >
                  Import transactions
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Bank accounts</div>
              <div className="stat__value">{accounts?.length ?? 0}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Shown here</div>
              <div className="stat__value">{rows.length}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Unmatched</div>
              <div className="stat__value">{unmatched}</div>
            </div>
          </div>

          <section className="bank-accounts" aria-labelledby="bank-accounts-title">
            <div className="section-head">
              <h2 id="bank-accounts-title">Accounts</h2>
              <p className="section__meta">
                Imported activity lands here before it is matched to the books.
              </p>
            </div>

            <div className="table-scroll">
              <table className="data-table bank-account-table">
                <caption className="sr-only">Bank and credit card accounts</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Type</th>
                    <th scope="col">Ledger account</th>
                    <th scope="col" className="num">
                      Transactions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts === null ? (
                    <tr>
                      <td colSpan={4} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : accounts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="accounts-empty">
                        No bank accounts yet. Add the checking or card account you want to work from.
                      </td>
                    </tr>
                  ) : (
                    accounts.map((account) => (
                      <tr
                        key={account.id}
                        className={`bank-account-row is-clickable${
                          account.id === selectedId ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelectedId(account.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(account.id);
                          }
                        }}
                      >
                        <td>
                          <span className="bank-account-name">{account.name}</span>
                        </td>
                        <td>{typeLabel(account.type)}</td>
                        <td>
                          {account.ledgerAccount.code} · {account.ledgerAccount.name}
                        </td>
                        <td className="num">{account.transactionCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bank-transactions" aria-labelledby="bank-transactions-title">
            <div className="section-head">
              <div>
                <h2 id="bank-transactions-title">Activity</h2>
                <p className="section__meta">
                  {selected
                    ? `Showing ${selected.name} through the selected filters.`
                    : 'Choose a bank account to see its activity.'}
                </p>
              </div>
            </div>

            <div className="bank-filters">
              <label>
                <span>From</span>
                <input
                  type="date"
                  aria-label="Transactions from date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  aria-label="Transactions to date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <label>
                <span>Match state</span>
                <select
                  aria-label="Filter transactions by match state"
                  value={matchFilter}
                  onChange={(event) =>
                    setMatchFilter(event.target.value as '' | BankTransactionMatchState)
                  }
                >
                  <option value="">All states</option>
                  {MATCH_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bank-filters__search">
                <span>Search</span>
                <input
                  type="search"
                  aria-label="Search bank transactions"
                  placeholder="Description or memo"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table bank-transaction-table">
                <caption className="sr-only">Imported bank transactions with match state</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Match state</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions === null ? (
                    <tr>
                      <td colSpan={5} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="accounts-empty">
                        No bank activity in this view.
                      </td>
                    </tr>
                  ) : (
                    rows.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{displayDate(transaction.date)}</td>
                        <td>{transaction.description}</td>
                        <td className="bank-source">
                          {transaction.importBatch.filename}
                          <span>{transaction.importBatch.format}</span>
                        </td>
                        <td
                          className={`num${
                            transaction.amount < 0 ? ' bank-amount-out' : ''
                          }`}
                        >
                          {signedMoney(transaction.amount)}
                        </td>
                        <td>
                          <span className={`status ${MATCH_CLASS[transaction.matchState]}`}>
                            <span className="dot"></span>
                            {transaction.matchState.charAt(0) +
                              transaction.matchState.slice(1).toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${accountFormOpen ? ' is-open' : ''}`}
        id="bank-account-form"
        aria-label="New bank account"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
            </svg>
          </span>
          <h2 className="margin__title">New bank account</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close bank account form"
            onClick={() => setAccountFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {accountError ? (
          <p className="members__error" role="alert">
            {accountError}
          </p>
        ) : null}

        <form className="drawer-form" onSubmit={(event) => void onAddAccount(event)}>
          <label className="drawer-form__label" htmlFor="bank-account-name">
            Account name
          </label>
          <input
            id="bank-account-name"
            required
            value={accountForm.name}
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Operating checking"
          />

          <label className="drawer-form__label" htmlFor="bank-account-type">
            Type
          </label>
          <select
            id="bank-account-type"
            value={accountForm.type}
            onChange={(event) => setAccountType(event.target.value as BankAccountType)}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="bank-ledger-account">
            Ledger account
          </label>
          <select
            id="bank-ledger-account"
            required
            value={accountForm.ledgerAccountId}
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, ledgerAccountId: event.target.value }))
            }
          >
            <option value="">Choose a ledger account</option>
            {eligibleLedgerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
          <p className="drawer-form__hint">
            {accountForm.type === 'CREDIT_CARD'
              ? 'Credit cards link to a liability account.'
              : 'Bank accounts link to an asset account.'}
          </p>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={accountBusy}>
              {accountBusy ? 'Adding…' : 'Add bank account'}
            </button>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${importOpen ? ' is-open' : ''}`}
        id="bank-import-form"
        aria-label="Import bank transactions"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M12 3v12M7 10l5 5 5-5" />
              <path d="M4 17v3h16v-3" />
            </svg>
          </span>
          <h2 className="margin__title">Import transactions</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close import form"
            onClick={() => setImportOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bank-import-account">
          <span>Into</span>
          <strong>{selected?.name ?? 'No account selected'}</strong>
          <span>{selected ? `${selected.ledgerAccount.code} · ${selected.ledgerAccount.name}` : ''}</span>
        </div>

        {importError ? (
          <p className="members__error" role="alert">
            {importError}
          </p>
        ) : null}

        <div className="drawer-form">
          <label className="drawer-form__label" htmlFor="bank-import-file">
            Bank file
          </label>
          <input
            id="bank-import-file"
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/ofx"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = '';
              onImportFile(file);
            }}
          />
          <p className="drawer-form__hint">CSV or OFX, up to 10 MB.</p>

          {importFile ? (
            <button
              className="btn btn--outline btn--sm"
              type="button"
              onClick={() => void runPreview()}
              disabled={importBusy}
            >
              {importBusy ? 'Reading the file…' : 'Preview import'}
            </button>
          ) : null}

          {importPreview?.mapping ? (
            <div className="bank-mapping">
              <div className="bank-mapping__head">
                <h3>Map the columns</h3>
                <p>Choose which column holds each field, then preview again.</p>
              </div>
              <div className="bank-mapping__grid">
                <label>
                  <span>Date column</span>
                  <select
                    aria-label="Date column"
                    value={importMapping.dateColumn ?? ''}
                    onChange={(event) => setMapping('dateColumn', event.target.value)}
                  >
                    <option value="">Choose a column</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Description column</span>
                  <select
                    aria-label="Description column"
                    value={importMapping.descriptionColumn ?? ''}
                    onChange={(event) => setMapping('descriptionColumn', event.target.value)}
                  >
                    <option value="">Choose a column</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Amount column</span>
                  <select
                    aria-label="Amount column"
                    value={importMapping.amountColumn ?? ''}
                    onChange={(event) => setMapping('amountColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Debit column</span>
                  <select
                    aria-label="Debit column"
                    value={importMapping.debitColumn ?? ''}
                    onChange={(event) => setMapping('debitColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Credit column</span>
                  <select
                    aria-label="Credit column"
                    value={importMapping.creditColumn ?? ''}
                    onChange={(event) => setMapping('creditColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>External ID column</span>
                  <select
                    aria-label="External ID column"
                    value={importMapping.externalIdColumn ?? ''}
                    onChange={(event) => setMapping('externalIdColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="btn btn--outline btn--sm"
                type="button"
                onClick={() => void runPreview()}
                disabled={importBusy}
              >
                {importBusy ? 'Reading the file…' : 'Refresh preview'}
              </button>
            </div>
          ) : null}

          {importPreview?.mappingError ? (
            <p className="members__error" role="alert">
              {importPreview.mappingError}
            </p>
          ) : null}

          {importPreview && !importPreview.mappingError ? (
            <div className="bank-import-preview" aria-label="Import preview">
              <div className="bank-preview-counts">
                <span>{importPreview.counts.newCount} new</span>
                <span>{importPreview.counts.duplicate} duplicate{importPreview.counts.duplicate === 1 ? '' : 's'}</span>
                <span>{importPreview.counts.invalid} invalid</span>
              </div>
              <div className="bank-preview-scroll">
                <table className="bank-preview-table">
                  <caption className="sr-only">Normalized transaction preview</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Date</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((row) => {
                      const status = previewStatus(row);
                      return (
                        <tr
                          key={row.rowNumber}
                          className={
                            status === 'Invalid'
                              ? 'is-invalid'
                              : status === 'Duplicate'
                                ? 'is-duplicate'
                                : undefined
                          }
                        >
                          <td>{row.rowNumber}</td>
                          <td>{row.date ? displayDate(row.date) : '—'}</td>
                          <td>
                            {row.description || '—'}
                            {row.error ? <span className="bank-row-error">{row.error}</span> : null}
                          </td>
                          <td className="num">{row.amount === null ? '—' : signedMoney(row.amount)}</td>
                          <td>
                            <span className="bank-preview-status">{status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bank-import-actions">
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  onClick={() => void onConfirmImport()}
                  disabled={importBusy || importPreview.counts.valid === 0}
                >
                  {importBusy ? 'Importing…' : 'Import transactions'}
                </button>
                <span className="drawer-form__hint">
                  {importPreview.counts.newCount} new · {importPreview.counts.duplicate} already in the book
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <div
        className={`scrim${accountFormOpen || importOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => {
          setAccountFormOpen(false);
          setImportOpen(false);
        }}
      />
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
