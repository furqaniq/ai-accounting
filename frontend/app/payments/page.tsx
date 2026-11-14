'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Customer,
  Invoice,
  Payment,
  PaymentInput,
  PaymentMethod,
  clearSession,
  createPayment,
  fetchActiveOrganization,
  fetchCustomers,
  fetchInvoices,
  fetchPayments,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
} from '@/lib/api';

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHECK', label: 'Check' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CHECK: 'Check',
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Other',
};

interface PaymentForm {
  customerId: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
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

function statusLabel(status: Invoice['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function isOpen(invoice: Invoice): boolean {
  return ['SENT', 'PARTIAL', 'OVERDUE'].includes(invoice.status) && invoice.balanceDue > 0;
}

export default function PaymentsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Payment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PaymentForm>({
    customerId: '',
    date: today(),
    method: 'BANK_TRANSFER',
    reference: '',
    notes: '',
  });
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
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
      const [customerRows, invoiceRows, paymentRows] = await Promise.all([
        fetchCustomers(activeOrg.organizationId),
        fetchInvoices(activeOrg.organizationId),
        fetchPayments(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setCustomers(customerRows);
      setInvoices(invoiceRows);
      setPayments(paymentRows);
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
      const [paymentRows, invoiceRows] = await Promise.all([
        fetchPayments(org.organizationId, { search: search.trim() || undefined }),
        fetchInvoices(org.organizationId),
      ]);
      setPayments(paymentRows);
      setInvoices(invoiceRows);
      setSelected((current) => {
        if (!current) return null;
        return paymentRows.find((payment) => payment.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The payment book is not available right now.');
    }
  }, [org, search]);

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
    const rows = payments ?? [];
    const received = rows.reduce((sum, payment) => sum + payment.amount, 0);
    const open = invoices.filter(isOpen);
    return {
      received,
      openCount: open.length,
      openBalance: open.reduce((sum, invoice) => sum + invoice.balanceDue, 0),
    };
  }, [payments, invoices]);

  const openInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.customerId === form.customerId && isOpen(invoice)),
    [invoices, form.customerId],
  );

  const allocationTotal = useMemo(
    () =>
      Math.round(
        Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0) * 100,
      ) / 100,
    [allocations],
  );

  const visiblePayments = useMemo(() => {
    if (!payments) return null;
    return payments;
  }, [payments]);

  function openCreate() {
    const preferred =
      customers.find((customer) =>
        invoices.some((invoice) => invoice.customerId === customer.id && isOpen(invoice)),
      ) ?? customers.find((customer) => customer.active) ?? customers[0];
    setForm({
      customerId: preferred?.id ?? '',
      date: today(),
      method: 'BANK_TRANSFER',
      reference: '',
      notes: '',
    });
    setAllocations({});
    setFormError(null);
    setFormOpen(true);
  }

  function chooseCustomer(customerId: string) {
    setForm((current) => ({ ...current, customerId }));
    setAllocations({});
  }

  function toggleInvoice(invoice: Invoice, checked: boolean) {
    setAllocations((current) => {
      const next = { ...current };
      if (checked) next[invoice.id] = invoice.balanceDue.toFixed(2);
      else delete next[invoice.id];
      return next;
    });
  }

  function setAllocation(invoiceId: string, value: string) {
    setAllocations((current) => ({ ...current, [invoiceId]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (!form.customerId) {
      setFormError('Choose the customer who paid.');
      return;
    }
    const applications = Object.entries(allocations)
      .map(([invoiceId, value]) => ({ invoiceId, amount: Number(value) }))
      .filter((application) => Number.isFinite(application.amount) && application.amount > 0);
    if (applications.length === 0) {
      setFormError('Choose at least one open invoice and an amount to apply.');
      return;
    }
    const invalid = applications.find((application) => {
      const invoice = invoices.find((row) => row.id === application.invoiceId);
      return !invoice || application.amount > invoice.balanceDue;
    });
    if (invalid) {
      setFormError('An applied amount is above the invoice balance.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const payload: PaymentInput = {
        customerId: form.customerId,
        date: form.date,
        amount: allocationTotal,
        method: form.method,
        reference: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
        applications,
      };
      const saved = await createPayment(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      setSearch('');
      await load();
      showToast(`${saved.number} recorded for ${money(saved.amount)}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not record that payment');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the cash receipts…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="payments" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Payments</h1>
              <p className="page-head__meta">
                {payments?.length ?? 0} receipt{(payments?.length ?? 0) === 1 ? '' : 's'}.
                {' '}{money(summary.received)} received.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  Record payment
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Received</div>
              <div className="stat__value">{money(summary.received)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Open invoices</div>
              <div className="stat__value">{summary.openCount}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Open balance</div>
              <div className="stat__value">{money(summary.openBalance)}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="payment-list-title">
            <h2 className="sr-only" id="payment-list-title">
              Payments received
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search payments</span>
                <input
                  type="search"
                  aria-label="Search payments"
                  placeholder="Search by receipt, customer or reference"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">
                Each receipt posts cash against receivables exactly once.
              </p>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table invoice-table payment-table">
                <caption className="sr-only">Customer payments with applied invoices</caption>
                <thead>
                  <tr>
                    <th scope="col">Payment</th>
                    <th scope="col">Date</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Method</th>
                    <th scope="col">Applied to</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments === null ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : visiblePayments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        No payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    visiblePayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className={`invoice-row is-clickable${
                          selected?.id === payment.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelected(payment)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(payment);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {payment.number}
                          </button>
                        </td>
                        <td>{displayDate(payment.date)}</td>
                        <td>{payment.customer.name}</td>
                        <td>{METHOD_LABEL[payment.method]}</td>
                        <td className="payment-invoices">
                          {payment.applications
                            .map((application) => application.invoice.number)
                            .join(', ')}
                        </td>
                        <td className="num">{money(payment.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selected ? (
            <section
              className="invoice-detail"
              id="payment-detail"
              aria-labelledby="payment-detail-number"
            >
              <div className="invoice-detail__head">
                <div>
                  <h2 id="payment-detail-number">Payment {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    {displayDate(selected.date)}. {METHOD_LABEL[selected.method]}.{' '}
                    {money(selected.amount)} received from {selected.customer.name}.
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => setSelected(null)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <table className="line-table">
                <caption className="sr-only">Invoices this payment was applied to</caption>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Invoice status</th>
                    <th scope="col" className="num">
                      Applied
                    </th>
                    <th scope="col" className="num">
                      Balance now
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.applications.map((application) => (
                    <tr key={application.id}>
                      <td>{application.invoice.number}</td>
                      <td>{statusLabel(application.invoice.status)}</td>
                      <td className="num">{money(application.amount)}</td>
                      <td className="num">{money(application.invoice.balanceDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-total">
                <div className="invoice-total__box">
                  <div className="invoice-total__row invoice-total__row--total">
                    <span>Receipt total</span>
                    <span>{money(selected.amount)}</span>
                  </div>
                </div>
              </div>

              {selected.reference ? (
                <p className="report-note">Reference: {selected.reference}</p>
              ) : null}
              {selected.notes ? <p className="report-note">{selected.notes}</p> : null}
            </section>
          ) : null}
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="payment-form"
        aria-label="Record payment"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M3 7h18v10H3zM3 10h18" />
              <circle cx="17" cy="14" r="1.2" />
            </svg>
          </span>
          <h2 className="margin__title">Record payment</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close payment form"
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

        <form className="drawer-form payment-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="drawer-form__label" htmlFor="payment-customer">
            Customer
          </label>
          <select
            id="payment-customer"
            required
            value={form.customerId}
            onChange={(event) => chooseCustomer(event.target.value)}
          >
            <option value="">Choose a customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="payment-date">
                Payment date
              </label>
              <input
                id="payment-date"
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="payment-method">
                Method
              </label>
              <select
                id="payment-method"
                value={form.method}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    method: event.target.value as PaymentMethod,
                  }))
                }
              >
                {METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="payment-allocations">
            <div className="invoice-form__lines-head">
              <span className="drawer-form__label">Open invoices</span>
              <span className="section__meta">Checked invoices default to their full balance.</span>
            </div>
            {!form.customerId ? (
              <p className="drawer-form__hint">Choose a customer to see their open invoices.</p>
            ) : openInvoices.length === 0 ? (
              <p className="drawer-form__hint">This customer has no open invoices.</p>
            ) : (
              <div className="table-scroll">
                <table className="payment-allocations__table">
                  <thead>
                    <tr>
                      <th scope="col">Apply</th>
                      <th scope="col">Invoice</th>
                      <th scope="col">Due</th>
                      <th scope="col" className="num">
                        Balance
                      </th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((invoice) => {
                      const checked = invoice.id in allocations;
                      return (
                        <tr key={invoice.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Apply ${invoice.number}`}
                              checked={checked}
                              onChange={(event) => toggleInvoice(invoice, event.target.checked)}
                            />
                          </td>
                          <td>{invoice.number}</td>
                          <td>{displayDate(invoice.dueDate)}</td>
                          <td className="num">{money(invoice.balanceDue)}</td>
                          <td className="num">
                            <input
                              type="number"
                              min="0.01"
                              max={invoice.balanceDue}
                              step="0.01"
                              aria-label={`Amount for ${invoice.number}`}
                              disabled={!checked}
                              value={allocations[invoice.id] ?? ''}
                              onChange={(event) => setAllocation(invoice.id, event.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <label className="drawer-form__label" htmlFor="payment-reference">
            Reference
          </label>
          <input
            id="payment-reference"
            value={form.reference}
            placeholder="Check number or transfer reference"
            onChange={(event) =>
              setForm((current) => ({ ...current, reference: event.target.value }))
            }
          />

          <label className="drawer-form__label" htmlFor="payment-notes">
            Notes
          </label>
          <input
            id="payment-notes"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />

          <dl className="invoice-form__totals" id="payment-total">
            <div className="invoice-form__totals-total">
              <dt>Payment total</dt>
              <dd>{money(allocationTotal)}</dd>
            </div>
          </dl>

          <div className="drawer-form__foot">
            <button
              className="btn btn--primary btn--sm"
              type="submit"
              disabled={busy || allocationTotal <= 0}
            >
              Record payment
            </button>
            <span className="drawer-form__hint">
              Posts a cash debit and receivables credit for the full receipt.
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
