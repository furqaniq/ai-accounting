'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Bill,
  BillPayment,
  BillPaymentInput,
  PaymentMethod,
  Vendor,
  clearSession,
  createBillPayment,
  fetchActiveOrganization,
  fetchBillPayments,
  fetchBills,
  fetchVendors,
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
  vendorId: string;
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

function statusLabel(status: Bill['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function isOpen(bill: Bill): boolean {
  return ['OPEN', 'PARTIAL', 'OVERDUE'].includes(bill.status) && bill.balanceDue > 0;
}

export default function BillPaymentsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<BillPayment[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BillPayment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PaymentForm>({
    vendorId: '',
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
      const [vendorRows, billRows, paymentRows] = await Promise.all([
        fetchVendors(activeOrg.organizationId),
        fetchBills(activeOrg.organizationId),
        fetchBillPayments(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setVendors(vendorRows);
      setBills(billRows);
      setPayments(paymentRows);

      const linkedId = new URLSearchParams(window.location.search).get('bill');
      const linked = linkedId ? billRows.find((bill) => bill.id === linkedId) : undefined;
      if (linked && isOpen(linked)) {
        setForm({
          vendorId: linked.vendorId,
          date: today(),
          method: 'BANK_TRANSFER',
          reference: '',
          notes: '',
        });
        setAllocations({ [linked.id]: linked.balanceDue.toFixed(2) });
        setSelected(null);
        setFormOpen(true);
      }
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
      const [paymentRows, billRows] = await Promise.all([
        fetchBillPayments(org.organizationId, { search: search.trim() || undefined }),
        fetchBills(org.organizationId),
      ]);
      setPayments(paymentRows);
      setBills(billRows);
      setSelected((current) => {
        if (!current) return null;
        return paymentRows.find((payment) => payment.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The bill payment book is not available right now.');
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
    const paid = rows.reduce((sum, payment) => sum + payment.amount, 0);
    const open = bills.filter(isOpen);
    return {
      paid,
      openCount: open.length,
      openBalance: open.reduce((sum, bill) => sum + bill.balanceDue, 0),
    };
  }, [payments, bills]);

  const openBills = useMemo(
    () => bills.filter((bill) => bill.vendorId === form.vendorId && isOpen(bill)),
    [bills, form.vendorId],
  );

  const allocationTotal = useMemo(
    () =>
      Math.round(
        Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0) * 100,
      ) / 100,
    [allocations],
  );

  function openCreate() {
    const preferred =
      vendors.find((vendor) =>
        bills.some((bill) => bill.vendorId === vendor.id && isOpen(bill)),
      ) ?? vendors.find((vendor) => vendor.active) ?? vendors[0];
    setForm({
      vendorId: preferred?.id ?? '',
      date: today(),
      method: 'BANK_TRANSFER',
      reference: '',
      notes: '',
    });
    setAllocations({});
    setFormError(null);
    setFormOpen(true);
  }

  function chooseVendor(vendorId: string) {
    setForm((current) => ({ ...current, vendorId }));
    setAllocations({});
  }

  function toggleBill(bill: Bill, checked: boolean) {
    setAllocations((current) => {
      const next = { ...current };
      if (checked) next[bill.id] = bill.balanceDue.toFixed(2);
      else delete next[bill.id];
      return next;
    });
  }

  function setAllocation(billId: string, value: string) {
    setAllocations((current) => ({ ...current, [billId]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (!form.vendorId) {
      setFormError('Choose the vendor being paid.');
      return;
    }
    const applications = Object.entries(allocations)
      .map(([billId, value]) => ({ billId, amount: Number(value) }))
      .filter((application) => Number.isFinite(application.amount) && application.amount > 0);
    if (applications.length === 0) {
      setFormError('Choose at least one open bill and an amount to apply.');
      return;
    }
    const invalid = applications.find((application) => {
      const bill = bills.find((row) => row.id === application.billId);
      return !bill || application.amount > bill.balanceDue;
    });
    if (invalid) {
      setFormError('An applied amount is above the bill balance.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const payload: BillPaymentInput = {
        vendorId: form.vendorId,
        date: form.date,
        amount: allocationTotal,
        method: form.method,
        reference: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
        applications,
      };
      const saved = await createBillPayment(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      setSearch('');
      await load();
      showToast(`${saved.number} recorded for ${money(saved.amount)}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not record that bill payment');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the bill payments…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="bill-payments" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Bill payments</h1>
              <p className="page-head__meta">
                {payments?.length ?? 0} payment{(payments?.length ?? 0) === 1 ? '' : 's'}.
                {' '}{money(summary.paid)} paid to vendors.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  Record bill payment
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Paid out</div>
              <div className="stat__value">{money(summary.paid)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Open bills</div>
              <div className="stat__value">{summary.openCount}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Open balance</div>
              <div className="stat__value">{money(summary.openBalance)}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="bill-payment-list-title">
            <h2 className="sr-only" id="bill-payment-list-title">
              Bill payments
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search bill payments</span>
                <input
                  type="search"
                  aria-label="Search bill payments"
                  placeholder="Search by payment, vendor or reference"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">
                Each payment debits payables and credits cash exactly once.
              </p>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table invoice-table payment-table">
                <caption className="sr-only">Bill payments with applied bills</caption>
                <thead>
                  <tr>
                    <th scope="col">Payment</th>
                    <th scope="col">Date</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Method</th>
                    <th scope="col">Applied to</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments === null ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : payments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="accounts-empty">
                        No bill payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    payments.map((payment) => (
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
                        <td>{payment.vendor.name}</td>
                        <td>{METHOD_LABEL[payment.method]}</td>
                        <td className="payment-invoices">
                          {payment.applications
                            .map((application) => application.bill.number)
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
              id="bill-payment-detail"
              aria-labelledby="bill-payment-detail-number"
            >
              <div className="invoice-detail__head">
                <div>
                  <h2 id="bill-payment-detail-number">Bill payment {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    {displayDate(selected.date)}. {METHOD_LABEL[selected.method]}.{' '}
                    {money(selected.amount)} paid to {selected.vendor.name}.
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
                <caption className="sr-only">Bills this payment was applied to</caption>
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col">Bill status</th>
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
                      <td>{application.bill.number}</td>
                      <td>{statusLabel(application.bill.status)}</td>
                      <td className="num">{money(application.amount)}</td>
                      <td className="num">{money(application.bill.balanceDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-total">
                <div className="invoice-total__box">
                  <div className="invoice-total__row invoice-total__row--total">
                    <span>Payment total</span>
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
        id="bill-payment-form"
        aria-label="Record bill payment"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M3 7h18v10H3zM3 10h18" />
              <path d="m16 15 2-2-2-2" />
            </svg>
          </span>
          <h2 className="margin__title">Record bill payment</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close bill payment form"
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
          <label className="drawer-form__label" htmlFor="bill-payment-vendor">
            Vendor
          </label>
          <select
            id="bill-payment-vendor"
            required
            value={form.vendorId}
            onChange={(event) => chooseVendor(event.target.value)}
          >
            <option value="">Choose a vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
                {vendor.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="bill-payment-date">
                Payment date
              </label>
              <input
                id="bill-payment-date"
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="bill-payment-method">
                Method
              </label>
              <select
                id="bill-payment-method"
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
              <span className="drawer-form__label">Open bills</span>
              <span className="section__meta">Checked bills default to their full balance.</span>
            </div>
            {!form.vendorId ? (
              <p className="drawer-form__hint">Choose a vendor to see their open bills.</p>
            ) : openBills.length === 0 ? (
              <p className="drawer-form__hint">This vendor has no open bills.</p>
            ) : (
              <div className="table-scroll">
                <table className="payment-allocations__table">
                  <thead>
                    <tr>
                      <th scope="col">Apply</th>
                      <th scope="col">Bill</th>
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
                    {openBills.map((bill) => {
                      const checked = bill.id in allocations;
                      return (
                        <tr key={bill.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Apply ${bill.number}`}
                              checked={checked}
                              onChange={(event) => toggleBill(bill, event.target.checked)}
                            />
                          </td>
                          <td>{bill.number}</td>
                          <td>{displayDate(bill.dueDate)}</td>
                          <td className="num">{money(bill.balanceDue)}</td>
                          <td className="num">
                            <input
                              type="number"
                              min="0.01"
                              max={bill.balanceDue}
                              step="0.01"
                              aria-label={`Amount for ${bill.number}`}
                              disabled={!checked}
                              value={allocations[bill.id] ?? ''}
                              onChange={(event) => setAllocation(bill.id, event.target.value)}
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

          <label className="drawer-form__label" htmlFor="bill-payment-reference">
            Reference
          </label>
          <input
            id="bill-payment-reference"
            value={form.reference}
            placeholder="Check number or transfer reference"
            onChange={(event) =>
              setForm((current) => ({ ...current, reference: event.target.value }))
            }
          />

          <label className="drawer-form__label" htmlFor="bill-payment-notes">
            Notes
          </label>
          <input
            id="bill-payment-notes"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />

          <dl className="invoice-form__totals" id="bill-payment-total">
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
              Posts a payables debit and cash credit for the full payment.
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
