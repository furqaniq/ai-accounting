'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import { AttachmentPanel } from '@/components/attachment-panel';
import {
  API_URL,
  Account,
  ActiveOrganization,
  Expense,
  ExpenseInput,
  Vendor,
  clearSession,
  createExpense,
  fetchAccounts,
  fetchActiveOrganization,
  fetchExpenses,
  fetchVendors,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  updateExpense,
} from '@/lib/api';

interface ExpenseForm {
  date: string;
  vendorId: string;
  categoryAccountId: string;
  amount: string;
  memo: string;
  receiptNote: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

function blankForm(categoryAccountId = ''): ExpenseForm {
  return {
    date: today(),
    vendorId: '',
    categoryAccountId,
    amount: '',
    memo: '',
    receiptNote: '',
  };
}

export default function ExpensesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selected, setSelected] = useState<Expense | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>(() => blankForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
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
      const [vendorRows, accountRows] = await Promise.all([
        fetchVendors(activeOrg.organizationId),
        fetchAccounts(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setVendors(vendorRows);
      setExpenseAccounts(
        accountRows.filter((account) => account.type === 'EXPENSE' && account.active),
      );
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
      const rows = await fetchExpenses(org.organizationId, {
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        categoryAccountId: categoryFilter || undefined,
        vendorId: vendorFilter || undefined,
      });
      setExpenses(rows);
      setSelected((current) => {
        if (!current) return null;
        return rows.find((expense) => expense.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The expense book is not available right now.');
    }
  }, [org, search, from, to, categoryFilter, vendorFilter]);

  useEffect(() => {
    if (!org) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load, org]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setFormOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const summary = useMemo(() => {
    const rows = expenses ?? [];
    return {
      total: rows.reduce((sum, expense) => sum + expense.amount, 0),
      count: rows.length,
      categories: new Set(rows.map((expense) => expense.categoryAccountId)).size,
    };
  }, [expenses]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm(expenseAccounts[0]?.id ?? ''));
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setForm({
      date: expense.date,
      vendorId: expense.vendorId ?? '',
      categoryAccountId: expense.categoryAccountId,
      amount: String(expense.amount),
      memo: expense.memo ?? '',
      receiptNote: expense.receiptNote ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof ExpenseForm>(field: K, value: ExpenseForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function clearFilters() {
    setSearch('');
    setFrom('');
    setTo('');
    setCategoryFilter('');
    setVendorFilter('');
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (!form.categoryAccountId) {
      setFormError('Choose an expense category.');
      return;
    }
    if (!form.date) {
      setFormError('Choose a date for this expense.');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter an amount greater than zero.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const payload: ExpenseInput = {
        date: form.date,
        vendorId: form.vendorId || (editing ? '' : undefined),
        categoryAccountId: form.categoryAccountId,
        amount,
        memo: form.memo.trim() || undefined,
        receiptNote: form.receiptNote.trim() || undefined,
      };
      const saved = editing
        ? await updateExpense(org.organizationId, editing.id, payload)
        : await createExpense(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      await load();
      showToast(
        editing
          ? `${saved.number} updated${saved.version > editing.version ? ' and corrected in the ledger' : ''}.`
          : `${saved.number} recorded and posted.`,
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that expense');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the expense book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="expenses" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Expenses</h1>
              <p className="page-head__meta">
                {summary.count} {summary.count === 1 ? 'expense' : 'expenses'}.{' '}
                {money(summary.total)} in this view.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New expense
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Total shown</div>
              <div className="stat__value">{money(summary.total)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Entries</div>
              <div className="stat__value">{summary.count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Categories</div>
              <div className="stat__value">{summary.categories}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="expense-list-title">
            <h2 className="sr-only" id="expense-list-title">
              Expense list
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search expenses</span>
                <input
                  type="search"
                  aria-label="Search expenses"
                  placeholder="Search memo, vendor, or number"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">
                Saving posts expense and cash immediately. Corrections reverse and repost.
              </p>
            </div>

            <div className="expense-filters">
              <label>
                <span>From</span>
                <input
                  type="date"
                  aria-label="Expenses from date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  aria-label="Expenses to date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <label>
                <span>Category</span>
                <select
                  aria-label="Filter expenses by category"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="">All categories</option>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Vendor</span>
                <select
                  aria-label="Filter expenses by vendor"
                  value={vendorFilter}
                  onChange={(event) => setVendorFilter(event.target.value)}
                >
                  <option value="">All vendors</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn--ghost btn--sm" type="button" onClick={clearFilters}>
                Clear
              </button>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table invoice-table expense-table">
                <caption className="sr-only">Quick expenses with category, vendor, and amount</caption>
                <thead>
                  <tr>
                    <th scope="col">Expense</th>
                    <th scope="col">Date</th>
                    <th scope="col">Category</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Memo</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expenses === null ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : expenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        No expenses in this view.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((expense) => (
                      <tr
                        key={expense.id}
                        className={`invoice-row is-clickable${
                          selected?.id === expense.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelected(expense)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(expense);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {expense.number}
                          </button>
                        </td>
                        <td>{displayDate(expense.date)}</td>
                        <td>
                          {expense.categoryAccount.code} · {expense.categoryAccount.name}
                        </td>
                        <td>{expense.vendor?.name ?? '—'}</td>
                        <td>{expense.memo ?? '—'}</td>
                        <td className="num">{money(expense.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {expenses && expenses.length > 0 ? (
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={5}>
                        Total shown
                      </th>
                      <td className="num">{money(summary.total)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          {selected ? (
            <section
              className="invoice-detail"
              id="expense-detail"
              aria-labelledby="expense-detail-number"
            >
              <div className="invoice-detail__head">
                <div>
                  <h2 id="expense-detail-number">Expense {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    {displayDate(selected.date)} · {selected.categoryAccount.code} ·{' '}
                    {selected.categoryAccount.name}
                    {selected.version > 1 ? ` · corrected ${selected.version - 1}×` : ''}
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  {editable ? (
                    <button
                      className="btn btn--outline"
                      type="button"
                      onClick={() => openEdit(selected)}
                    >
                      Edit expense
                    </button>
                  ) : null}
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="invoice-parties">
                <div>
                  <div className="party-label">Category</div>
                  <div className="party-name">
                    {selected.categoryAccount.code} · {selected.categoryAccount.name}
                  </div>
                  <div className="party-line">Expense account</div>
                </div>
                <div>
                  <div className="party-label">Paid to</div>
                  <div className="party-name">{selected.vendor?.name ?? 'No vendor'}</div>
                  {selected.vendor ? (
                    <div className="party-line">{selected.vendor.code}</div>
                  ) : (
                    <div className="party-line">Vendor optional</div>
                  )}
                </div>
              </div>

              <div className="invoice-total">
                <div className="invoice-total__box">
                  <div className="invoice-total__row invoice-total__row--total">
                    <span>Amount</span>
                    <span>{money(selected.amount)}</span>
                  </div>
                </div>
              </div>

              <p className="report-note">
                Posted to {selected.categoryAccount.code} {selected.categoryAccount.name} and
                paid from Cash 1000. Each correction reverses the prior entry and posts the new
                amount.
              </p>
              {selected.memo ? (
                <p className="report-note">
                  <strong>Memo.</strong> {selected.memo}
                </p>
              ) : null}
              {selected.receiptNote ? (
                <p className="report-note">
                  <strong>Receipt note.</strong> {selected.receiptNote}
                </p>
              ) : null}

              {org ? (
                <AttachmentPanel
                  organizationId={org.organizationId}
                  entityType="EXPENSE"
                  entityId={selected.id}
                  canManage={editable}
                  title="Receipts & documents"
                  attachLabel="Attach receipt"
                  hint="Scan or photograph the receipt. PDF, PNG, JPEG, or WebP up to 10 MB."
                />
              ) : null}
            </section>
          ) : null}
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="expense-form"
        aria-label={editing ? 'Edit expense' : 'New expense'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M3 7h18v10H3z" />
              <path d="M3 10h18" />
              <path d="M7 14h4" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit expense' : 'New expense'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close expense form"
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
          <label className="drawer-form__label" htmlFor="expense-date">
            Date
          </label>
          <input
            id="expense-date"
            type="date"
            required
            value={form.date}
            onChange={(event) => setField('date', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="expense-vendor">
            Vendor
          </label>
          <select
            id="expense-vendor"
            value={form.vendorId}
            onChange={(event) => setField('vendorId', event.target.value)}
          >
            <option value="">No vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
                {vendor.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="expense-category">
            Category
          </label>
          <select
            id="expense-category"
            required
            value={form.categoryAccountId}
            onChange={(event) => setField('categoryAccountId', event.target.value)}
          >
            <option value="">Choose an expense account</option>
            {expenseAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="expense-amount">
            Amount
          </label>
          <input
            id="expense-amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.amount}
            onChange={(event) => setField('amount', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="expense-memo">
            Memo
          </label>
          <input
            id="expense-memo"
            value={form.memo}
            onChange={(event) => setField('memo', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="expense-receipt">
            Receipt note
          </label>
          <input
            id="expense-receipt"
            placeholder="e.g. receipt-1042.jpg"
            value={form.receiptNote}
            onChange={(event) => setField('receiptNote', event.target.value)}
          />
          <p className="drawer-form__hint">
            Optional note about the paper receipt. Attach the actual file from the expense detail.
          </p>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editing ? 'Save expense' : 'Record expense'}
            </button>
            <span className="drawer-form__hint">
              Saving posts the expense and cash entry to the ledger.
            </span>
          </div>
        </form>
      </aside>

      <div
        className={`scrim${formOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => setFormOpen(false)}
      />
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
