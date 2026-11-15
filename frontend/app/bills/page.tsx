'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  Account,
  ActiveOrganization,
  Bill,
  BillInput,
  BillStatus,
  OrgSettings,
  Vendor,
  clearSession,
  createBill,
  fetchAccounts,
  fetchActiveOrganization,
  fetchBills,
  fetchSettings,
  fetchVendors,
  getAccessToken,
  getActiveOrgId,
  openBill,
  setActiveOrgId,
  updateBill,
} from '@/lib/api';

type Filter = 'ALL' | BillStatus;

interface DraftLine {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  expenseAccountId: string;
}

interface BillForm {
  vendorId: string;
  issueDate: string;
  dueDate: string;
  taxRate: string;
  notes: string;
  lines: DraftLine[];
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Open' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' },
];

const STATUS_CLASS: Record<BillStatus, string> = {
  DRAFT: 'status--draft',
  OPEN: 'status--sent',
  PARTIAL: 'status--amber',
  PAID: 'status--paid',
  OVERDUE: 'status--overdue',
};

let nextLineKey = 1;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function blankLine(expenseAccountId = ''): DraftLine {
  return { key: nextLineKey++, description: '', quantity: '1', unitPrice: '', expenseAccountId };
}

function lineAmount(line: DraftLine): number {
  const quantity = Number(line.quantity);
  const rate = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return 0;
  return Math.round(quantity * rate * 100) / 100;
}

export default function BillsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Bill | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [form, setForm] = useState<BillForm>(() => ({
    vendorId: '',
    issueDate: today(),
    dueDate: addDays(today(), 30),
    taxRate: '0',
    notes: '',
    lines: [blankLine()],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const linkedBillId = useRef<string | null>(null);

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
      const [orgSettings, vendorRows, accountRows] = await Promise.all([
        fetchSettings(activeOrg.organizationId),
        fetchVendors(activeOrg.organizationId),
        fetchAccounts(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setSettings(orgSettings);
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
      const rows = await fetchBills(org.organizationId, {
        search: search.trim() || undefined,
      });
      setBills(rows);
      setSelected((current) => {
        if (!current) return null;
        return rows.find((bill) => bill.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The bill book is not available right now.');
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
    linkedBillId.current = new URLSearchParams(window.location.search).get('bill');
  }, []);

  useEffect(() => {
    if (!bills || !linkedBillId.current) return;
    const linked = bills.find((bill) => bill.id === linkedBillId.current);
    linkedBillId.current = null;
    if (!linked) return;
    setSelected(linked);
    window.setTimeout(() => {
      document.getElementById('bill-detail')?.scrollIntoView({ block: 'start' });
    }, 0);
  }, [bills]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setFormOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const visibleBills = useMemo(() => {
    if (!bills) return null;
    return filter === 'ALL' ? bills : bills.filter((bill) => bill.status === filter);
  }, [bills, filter]);

  const summary = useMemo(() => {
    const rows = bills ?? [];
    const open = rows.filter((bill) => ['OPEN', 'PARTIAL', 'OVERDUE'].includes(bill.status));
    const overdue = rows.filter((bill) => bill.status === 'OVERDUE');
    return {
      open: open.reduce((sum, bill) => sum + bill.balanceDue, 0),
      overdue: overdue.reduce((sum, bill) => sum + bill.balanceDue, 0),
      drafts: rows.filter((bill) => bill.status === 'DRAFT').length,
    };
  }, [bills]);

  const formTotals = useMemo(() => {
    const subtotal = form.lines.reduce((sum, line) => sum + lineAmount(line), 0);
    const rate = Number(form.taxRate) / 100;
    const tax = Number.isFinite(rate) ? Math.round(subtotal * rate * 100) / 100 : 0;
    return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
  }, [form]);

  function openCreate() {
    const vendor = vendors.find((row) => row.active) ?? vendors[0];
    const account = expenseAccounts[0];
    const issueDate = today();
    setEditing(null);
    setForm({
      vendorId: vendor?.id ?? '',
      issueDate,
      dueDate: addDays(issueDate, 30),
      taxRate: String(Number(((settings?.defaultTaxRate ?? 0) * 100).toFixed(4))),
      notes: '',
      lines: [blankLine(account?.id ?? '')],
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(bill: Bill) {
    setEditing(bill);
    setForm({
      vendorId: bill.vendorId,
      issueDate: bill.issueDate,
      dueDate: bill.dueDate,
      taxRate: String(Number((bill.taxRate * 100).toFixed(4))),
      notes: bill.notes ?? '',
      lines: bill.lines.map((line) => ({
        key: nextLineKey++,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        expenseAccountId: line.expenseAccountId,
      })),
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof BillForm>(field: K, value: BillForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, blankLine(expenseAccounts[0]?.id ?? '')],
    }));
  }

  function removeLine(key: number) {
    setForm((current) =>
      current.lines.length === 1
        ? current
        : { ...current, lines: current.lines.filter((line) => line.key !== key) },
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (!form.vendorId) {
      setFormError('Choose a vendor for this bill.');
      return;
    }
    if (
      form.lines.some(
        (line) =>
          !line.description.trim() ||
          !line.expenseAccountId ||
          Number(line.quantity) <= 0 ||
          Number(line.unitPrice) < 0,
      )
    ) {
      setFormError('Every line needs a description, expense account, quantity, and rate.');
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const payload: BillInput = {
        vendorId: form.vendorId,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        taxRate: Number(form.taxRate) / 100,
        notes: form.notes.trim() || undefined,
        lines: form.lines.map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          expenseAccountId: line.expenseAccountId,
        })),
      };
      const saved = editing
        ? await updateBill(org.organizationId, editing.id, payload)
        : await createBill(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      setFilter('ALL');
      setSearch('');
      await load();
      showToast(editing ? `${saved.number} updated.` : `${saved.number} drafted.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that bill');
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(bill: Bill) {
    if (!org || busy) return;
    setBusy(true);
    try {
      const saved = await openBill(org.organizationId, bill.id);
      setSelected(saved);
      await load();
      showToast(`${saved.number} opened and posted to the ledger.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that bill');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the bill book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="bills" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Bills</h1>
              <p className="page-head__meta">
                {bills?.length ?? 0} bills. {money(summary.open)} open to vendors.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New bill
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Open payables</div>
              <div className="stat__value">{money(summary.open)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Overdue</div>
              <div className="stat__value is-negative">{money(summary.overdue)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Drafts</div>
              <div className="stat__value">{summary.drafts}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="bill-list-title">
            <h2 className="sr-only" id="bill-list-title">
              Bill list
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search bills</span>
                <input
                  type="search"
                  aria-label="Search bills"
                  placeholder="Search by bill number or vendor"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">Draft bills stay off the ledger until opened.</p>
            </div>

            <div className="filters" role="group" aria-label="Filter bills">
              {FILTERS.map((entry) => (
                <button
                  key={entry.value}
                  className="filter"
                  type="button"
                  aria-pressed={filter === entry.value}
                  onClick={() => setFilter(entry.value)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table invoice-table bill-table">
                <caption className="sr-only">Bills with status and amount due</caption>
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBills === null ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : visibleBills.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        No bills in this view.
                      </td>
                    </tr>
                  ) : (
                    visibleBills.map((bill) => (
                      <tr
                        key={bill.id}
                        className={`invoice-row is-clickable${
                          selected?.id === bill.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelected(bill)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(bill);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {bill.number}
                          </button>
                        </td>
                        <td>{bill.vendor.name}</td>
                        <td>{displayDate(bill.issueDate)}</td>
                        <td>{displayDate(bill.dueDate)}</td>
                        <td>
                          <span className={`status ${STATUS_CLASS[bill.status]}`}>
                            <span className="dot"></span>
                            {bill.status.charAt(0) + bill.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                        <td className="num">{money(bill.total)}</td>
                        <td className="num">{money(bill.balanceDue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selected ? (
            <section className="invoice-detail" id="bill-detail" aria-labelledby="bill-detail-number">
              <div className="invoice-detail__head">
                <div>
                  <h2 id="bill-detail-number">Bill {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    Issued {displayDate(selected.issueDate)}. Due {displayDate(selected.dueDate)}.{' '}
                    <span className={`status ${STATUS_CLASS[selected.status]}`}>
                      <span className="dot"></span>
                      {selected.status.charAt(0) + selected.status.slice(1).toLowerCase()}
                    </span>
                    {selected.status === 'OVERDUE' ? (
                      <> {selected.daysOverdue} days overdue.</>
                    ) : null}
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  {editable && selected.status === 'DRAFT' ? (
                    <>
                      <button
                        className="btn btn--outline"
                        type="button"
                        onClick={() => openEdit(selected)}
                      >
                        Edit bill
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onOpen(selected)}
                      >
                        Open bill
                      </button>
                    </>
                  ) : null}
                  {selected.status !== 'DRAFT' && selected.balanceDue > 0 ? (
                    <a
                      className="btn btn--primary"
                      href={`/bill-payments?bill=${selected.id}`}
                    >
                      Record payment
                    </a>
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
                  <div className="party-label">Payable to</div>
                  <div className="party-name">{selected.vendor.name}</div>
                  {selected.vendor.contactName ? (
                    <div className="party-line">{selected.vendor.contactName}</div>
                  ) : null}
                  {[selected.vendor.addressLine1, selected.vendor.addressLine2]
                    .filter(Boolean)
                    .map((line) => (
                      <div className="party-line" key={line}>
                        {line}
                      </div>
                    ))}
                  {[selected.vendor.city, selected.vendor.region, selected.vendor.postalCode]
                    .filter(Boolean)
                    .length > 0 ? (
                    <div className="party-line">
                      {[
                        selected.vendor.city,
                        selected.vendor.region,
                        selected.vendor.postalCode,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  ) : null}
                  {selected.vendor.email ? (
                    <div className="party-line">{selected.vendor.email}</div>
                  ) : null}
                </div>
                <div>
                  <div className="party-label">Book</div>
                  <div className="party-name">{org?.organizationName}</div>
                  <div className="party-line">
                    {org?.role.charAt(0) + (org?.role ?? '').slice(1).toLowerCase()}
                  </div>
                </div>
              </div>

              <div className="table-scroll">
                <table className="line-table">
                  <caption className="sr-only">Bill line items</caption>
                  <thead>
                    <tr>
                      <th scope="col">Description</th>
                      <th scope="col">Expense account</th>
                      <th scope="col" className="num">
                        Qty
                      </th>
                      <th scope="col" className="num">
                        Rate
                      </th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.description}</td>
                        <td>
                          {line.expenseAccount.code} · {line.expenseAccount.name}
                        </td>
                        <td className="num">{line.quantity}</td>
                        <td className="num">{money(line.unitPrice)}</td>
                        <td className="num">{money(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoice-total">
                <div className="invoice-total__box">
                  <div className="invoice-total__row">
                    <span>Subtotal</span>
                    <span>{money(selected.subtotal)}</span>
                  </div>
                  <div className="invoice-total__row">
                    <span>Tax ({(selected.taxRate * 100).toFixed(2)}%)</span>
                    <span>{money(selected.taxTotal)}</span>
                  </div>
                  <div className="invoice-total__row invoice-total__row--total">
                    <span>Total</span>
                    <span>{money(selected.total)}</span>
                  </div>
                  {selected.amountPaid > 0 ? (
                    <div className="invoice-total__row">
                      <span>Paid</span>
                      <span>{money(selected.amountPaid)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <p className="report-note">
                {selected.status === 'DRAFT'
                  ? 'Draft, not opened. Opening posts the expense and payable to the ledger.'
                  : selected.amountPaid > 0
                    ? `${money(selected.amountPaid)} paid; ${money(selected.balanceDue)} remains due.`
                    : `Balance due ${money(selected.balanceDue)}.`}
              </p>

              {selected.notes ? <p className="report-note">{selected.notes}</p> : null}

              <div className="timeline">
                <div className="timeline__title">Activity</div>
                <div className="timeline__list">
                  <div className="timeline__item is-done">
                    <div className="timeline__date">{displayDate(selected.issueDate)}</div>
                    <div className="timeline__label">Draft</div>
                  </div>
                  <div className={`timeline__item${selected.openedAt ? ' is-done' : ''}`}>
                    <div className="timeline__date">
                      {selected.openedAt
                        ? displayDate(selected.openedAt.slice(0, 10))
                        : 'Not opened'}
                    </div>
                    <div className="timeline__label">Opened</div>
                  </div>
                  <div className="timeline__item is-done">
                    <div className="timeline__date">{displayDate(selected.dueDate)}</div>
                    <div className="timeline__label">Due</div>
                  </div>
                  {selected.status === 'OVERDUE' ? (
                    <div className="timeline__item is-done is-overdue">
                      <div className="timeline__date">{selected.daysOverdue} days</div>
                      <div className="timeline__label">Overdue</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="bill-form"
        aria-label={editing ? 'Edit bill' : 'New bill'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
              <path d="M9 8h6M9 12h6M9 16h3" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit bill' : 'New bill'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close bill form"
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

        <form className="drawer-form invoice-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="drawer-form__label" htmlFor="bill-vendor">
            Vendor
          </label>
          <select
            id="bill-vendor"
            required
            value={form.vendorId}
            onChange={(event) => setField('vendorId', event.target.value)}
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
              <label className="drawer-form__label" htmlFor="bill-issue-date">
                Issue date
              </label>
              <input
                id="bill-issue-date"
                type="date"
                required
                value={form.issueDate}
                onChange={(event) => setField('issueDate', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="bill-due-date">
                Due date
              </label>
              <input
                id="bill-due-date"
                type="date"
                required
                value={form.dueDate}
                onChange={(event) => setField('dueDate', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__label" htmlFor="bill-tax-rate">
            Tax rate (%)
          </label>
          <input
            id="bill-tax-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.taxRate}
            onChange={(event) => setField('taxRate', event.target.value)}
          />

          <div className="invoice-form__lines-head">
            <span className="drawer-form__label">Lines</span>
            <button className="btn btn--ghost btn--sm" type="button" onClick={addLine}>
              Add line
            </button>
          </div>

          <div className="invoice-form__lines">
            {form.lines.map((line, index) => (
              <div className="invoice-form__line" key={line.key}>
                <div className="drawer-form__pair">
                  <div>
                    <label className="drawer-form__label" htmlFor={`bill-description-${line.key}`}>
                      Line {index + 1} description
                    </label>
                    <input
                      id={`bill-description-${line.key}`}
                      required
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.key, { description: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="drawer-form__label" htmlFor={`bill-account-${line.key}`}>
                      Line {index + 1} expense account
                    </label>
                    <select
                      id={`bill-account-${line.key}`}
                      required
                      value={line.expenseAccountId}
                      onChange={(event) =>
                        updateLine(line.key, { expenseAccountId: event.target.value })
                      }
                    >
                      <option value="">Choose an account</option>
                      {expenseAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="invoice-form__numbers">
                  <div>
                    <label className="drawer-form__label" htmlFor={`bill-qty-${line.key}`}>
                      Line {index + 1} quantity
                    </label>
                    <input
                      id={`bill-qty-${line.key}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="drawer-form__label" htmlFor={`bill-rate-${line.key}`}>
                      Line {index + 1} rate
                    </label>
                    <input
                      id={`bill-rate-${line.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                    />
                  </div>
                  <div className="invoice-form__amount">
                    <span className="drawer-form__label">Amount</span>
                    <span>{money(lineAmount(line))}</span>
                  </div>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={form.lines.length === 1}
                    onClick={() => removeLine(line.key)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <label className="drawer-form__label" htmlFor="bill-notes">
            Notes
          </label>
          <input
            id="bill-notes"
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
          />

          <dl className="invoice-form__totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(formTotals.subtotal)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{money(formTotals.tax)}</dd>
            </div>
            <div className="invoice-form__totals-total">
              <dt>Total</dt>
              <dd>{money(formTotals.total)}</dd>
            </div>
          </dl>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editing ? 'Save bill' : 'Create draft'}
            </button>
            <span className="drawer-form__hint">
              Drafts do not post. Opening posts expense, tax, and payable.
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
