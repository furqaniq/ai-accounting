'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Customer,
  Estimate,
  EstimateInput,
  EstimateStatus,
  Item,
  OrgSettings,
  clearSession,
  convertEstimate,
  createEstimate,
  fetchActiveOrganization,
  fetchCustomers,
  fetchEstimate,
  fetchEstimates,
  fetchItems,
  fetchSettings,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  updateEstimate,
  updateEstimateStatus,
} from '@/lib/api';

type Filter = 'ALL' | EstimateStatus;

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
  unitPrice: string;
}

interface EstimateForm {
  customerId: string;
  issueDate: string;
  expiryDate: string;
  taxRate: string;
  notes: string;
  lines: DraftLine[];
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DECLINED', label: 'Declined' },
];

const STATUS_CLASS: Record<EstimateStatus, string> = {
  DRAFT: 'status--draft',
  SENT: 'status--sent',
  ACCEPTED: 'status--paid',
  DECLINED: 'status--overdue',
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

function statusLabel(status: EstimateStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function blankLine(itemId = ''): DraftLine {
  return { key: nextLineKey++, itemId, quantity: '1', unitPrice: '' };
}

function lineAmount(line: DraftLine, items: Item[]): number {
  const item = items.find((row) => row.id === line.itemId);
  const qty = Number(line.quantity);
  const rate = line.unitPrice === '' ? item?.price ?? 0 : Number(line.unitPrice);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0;
  return Math.round(qty * rate * 100) / 100;
}

export default function EstimatesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Estimate | null>(null);
  const [form, setForm] = useState<EstimateForm>(() => ({
    customerId: '',
    issueDate: today(),
    expiryDate: addDays(today(), 30),
    taxRate: '0',
    notes: '',
    lines: [blankLine()],
  }));
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
      const [orgSettings, customerRows, itemRows, estimateRows] = await Promise.all([
        fetchSettings(activeOrg.organizationId),
        fetchCustomers(activeOrg.organizationId),
        fetchItems(activeOrg.organizationId),
        fetchEstimates(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setSettings(orgSettings);
      setCustomers(customerRows);
      setItems(itemRows);
      setEstimates(estimateRows);
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
      const rows = await fetchEstimates(org.organizationId, {
        search: search.trim() || undefined,
      });
      setEstimates(rows);
      setSelected((current) => {
        if (!current) return null;
        return rows.find((estimate) => estimate.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The estimate book is not available right now.');
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

  const visibleEstimates = useMemo(() => {
    if (!estimates) return null;
    return filter === 'ALL'
      ? estimates
      : estimates.filter((estimate) => estimate.status === filter);
  }, [estimates, filter]);

  const summary = useMemo(() => {
    const rows = estimates ?? [];
    const open = rows
      .filter((estimate) => !estimate.convertedInvoice && estimate.status !== 'DECLINED')
      .reduce((sum, estimate) => sum + estimate.total, 0);
    const accepted = rows.filter(
      (estimate) => estimate.status === 'ACCEPTED' && !estimate.convertedInvoice,
    ).length;
    const drafts = rows.filter((estimate) => estimate.status === 'DRAFT').length;
    return { open, accepted, drafts };
  }, [estimates]);

  const formTotals = useMemo(() => {
    const subtotal = form.lines.reduce((sum, line) => sum + lineAmount(line, items), 0);
    const taxable = form.lines.reduce((sum, line) => {
      const item = items.find((row) => row.id === line.itemId);
      return item?.taxable ? sum + lineAmount(line, items) : sum;
    }, 0);
    const rate = Number(form.taxRate) / 100;
    const tax = Number.isFinite(rate) ? Math.round(taxable * rate * 100) / 100 : 0;
    return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
  }, [form, items]);

  function openCreate() {
    const firstCustomer = customers.find((customer) => customer.active) ?? customers[0];
    const firstItem = items.find((item) => item.active) ?? items[0];
    const issueDate = today();
    const line = blankLine(firstItem?.id ?? '');
    if (firstItem) line.unitPrice = String(firstItem.price);
    setEditing(null);
    setForm({
      customerId: firstCustomer?.id ?? '',
      issueDate,
      expiryDate: addDays(issueDate, 30),
      taxRate: String(Number(((settings?.defaultTaxRate ?? 0) * 100).toFixed(4))),
      notes: '',
      lines: [line],
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(estimate: Estimate) {
    setEditing(estimate);
    setForm({
      customerId: estimate.customerId,
      issueDate: estimate.issueDate,
      expiryDate: estimate.expiryDate ?? '',
      taxRate: String(Number((estimate.taxRate * 100).toFixed(4))),
      notes: estimate.notes ?? '',
      lines: estimate.lines.map((line) => ({
        key: nextLineKey++,
        itemId: line.itemId,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      })),
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof EstimateForm>(field: K, value: EstimateForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }

  function chooseItem(line: DraftLine, itemId: string) {
    const item = items.find((row) => row.id === itemId);
    updateLine(line.key, {
      itemId,
      unitPrice: item ? String(item.price) : line.unitPrice,
    });
  }

  function addLine() {
    const firstItem = items.find((item) => item.active) ?? items[0];
    const line = blankLine(firstItem?.id ?? '');
    if (firstItem) line.unitPrice = String(firstItem.price);
    setForm((current) => ({ ...current, lines: [...current.lines, line] }));
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
    if (!form.customerId) {
      setFormError('Choose a customer for this estimate.');
      return;
    }
    if (form.lines.some((line) => !line.itemId || Number(line.quantity) <= 0)) {
      setFormError('Every line needs an item and a quantity above zero.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: EstimateInput = {
        customerId: form.customerId,
        issueDate: form.issueDate,
        expiryDate: form.expiryDate || undefined,
        taxRate: Number(form.taxRate) / 100,
        notes: form.notes.trim() || undefined,
        lines: form.lines.map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
      };
      const saved = editing
        ? await updateEstimate(org.organizationId, editing.id, payload)
        : await createEstimate(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      setFilter('ALL');
      setSearch('');
      await load();
      showToast(editing ? `${saved.number} updated.` : `${saved.number} drafted.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that estimate');
    } finally {
      setBusy(false);
    }
  }

  async function onStatus(estimate: Estimate, status: Exclude<EstimateStatus, 'DRAFT'>) {
    if (!org || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await updateEstimateStatus(org.organizationId, estimate.id, status);
      setSelected(saved);
      await load();
      showToast(`${saved.number} marked ${statusLabel(status).toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that status');
    } finally {
      setBusy(false);
    }
  }

  async function onConvert(estimate: Estimate) {
    if (!org || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await convertEstimate(org.organizationId, estimate.id);
      setSelected(saved);
      await load();
      showToast(`${saved.number} converted to ${saved.convertedInvoice?.number}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert that estimate');
      try {
        setSelected(await fetchEstimate(org.organizationId, estimate.id));
      } catch {
        // keep the current detail visible
      }
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the estimate book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="estimates" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Estimates</h1>
              <p className="page-head__meta">
                {estimates?.length ?? 0} quotes. {money(summary.open)} open.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New estimate
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Open quotes</div>
              <div className="stat__value">{money(summary.open)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Accepted</div>
              <div className="stat__value">{summary.accepted}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Drafts</div>
              <div className="stat__value">{summary.drafts}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="estimate-list-title">
            <h2 className="sr-only" id="estimate-list-title">
              Estimate list
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search estimates</span>
                <input
                  type="search"
                  aria-label="Search estimates"
                  placeholder="Search by number or customer"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">
                Quotes never post. Accepted work becomes a draft invoice.
              </p>
            </div>

            <div className="filters" role="group" aria-label="Filter estimates">
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
              <table className="data-table invoice-table estimate-table">
                <caption className="sr-only">Estimates with status and amount</caption>
                <thead>
                  <tr>
                    <th scope="col">Estimate</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Total
                    </th>
                    <th scope="col">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEstimates === null ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : visibleEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        No estimates in this view.
                      </td>
                    </tr>
                  ) : (
                    visibleEstimates.map((estimate) => (
                      <tr
                        key={estimate.id}
                        className={`invoice-row is-clickable${
                          selected?.id === estimate.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelected(estimate)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(estimate);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {estimate.number}
                          </button>
                        </td>
                        <td>{estimate.customer.name}</td>
                        <td>{displayDate(estimate.issueDate)}</td>
                        <td>{estimate.expiryDate ? displayDate(estimate.expiryDate) : '—'}</td>
                        <td>
                          <span className={`status ${STATUS_CLASS[estimate.status]}`}>
                            <span className="dot"></span>
                            {statusLabel(estimate.status)}
                          </span>
                        </td>
                        <td className="num">{money(estimate.total)}</td>
                        <td className="table-subline">
                          {estimate.convertedInvoice?.number ?? '—'}
                        </td>
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
              id="estimate-detail"
              aria-labelledby="estimate-detail-number"
            >
              <div className="invoice-detail__head">
                <div>
                  <h2 id="estimate-detail-number">Estimate {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    Issued {displayDate(selected.issueDate)}.{' '}
                    {selected.expiryDate
                      ? `Expires ${displayDate(selected.expiryDate)}.`
                      : 'No expiry.'}{' '}
                    <span className={`status ${STATUS_CLASS[selected.status]}`}>
                      <span className="dot"></span>
                      {statusLabel(selected.status)}
                    </span>
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  {editable && selected.status === 'DRAFT' && !selected.convertedInvoice ? (
                    <>
                      <button
                        className="btn btn--outline"
                        type="button"
                        onClick={() => openEdit(selected)}
                      >
                        Edit estimate
                      </button>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void onStatus(selected, 'SENT')}
                      >
                        Mark sent
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onStatus(selected, 'ACCEPTED')}
                      >
                        Accept quote
                      </button>
                    </>
                  ) : null}
                  {editable && selected.status === 'SENT' && !selected.convertedInvoice ? (
                    <>
                      <button
                        className="btn btn--ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void onStatus(selected, 'DECLINED')}
                      >
                        Decline
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onStatus(selected, 'ACCEPTED')}
                      >
                        Accept quote
                      </button>
                    </>
                  ) : null}
                  {editable && selected.status === 'ACCEPTED' && !selected.convertedInvoice ? (
                    <button
                      className="btn btn--primary"
                      type="button"
                      disabled={busy}
                      onClick={() => void onConvert(selected)}
                    >
                      Convert to invoice
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
                  <div className="party-label">Prepared for</div>
                  <div className="party-name">{selected.customer.name}</div>
                  {selected.customer.contactName ? (
                    <div className="party-line">{selected.customer.contactName}</div>
                  ) : null}
                  {selected.customer.email ? (
                    <div className="party-line">{selected.customer.email}</div>
                  ) : null}
                </div>
                <div>
                  <div className="party-label">From</div>
                  <div className="party-name">{org?.organizationName}</div>
                  <div className="party-line">
                    {org?.role.charAt(0) + (org?.role ?? '').slice(1).toLowerCase()}
                  </div>
                </div>
              </div>

              <table className="line-table">
                <caption className="sr-only">Estimate line items</caption>
                <thead>
                  <tr>
                    <th scope="col">Description</th>
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
                      <td>
                        {line.description}
                        <div className="table-subline">{line.item.code}</div>
                      </td>
                      <td className="num">{line.quantity}</td>
                      <td className="num">{money(line.unitPrice)}</td>
                      <td className="num">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

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
                </div>
              </div>

              {selected.convertedInvoice ? (
                <div className="estimate-converted" role="status">
                  <p>
                    Converted to <strong>{selected.convertedInvoice.number}</strong>. This estimate
                    is locked to that invoice.
                  </p>
                  <a className="btn btn--outline btn--sm" href="/invoices">
                    Open invoices
                  </a>
                </div>
              ) : (
                <p className="report-note">
                  {selected.status === 'ACCEPTED'
                    ? 'Accepted. Converting copies the customer and lines into a draft invoice; nothing posts until that invoice is sent.'
                    : 'Quotes stay off the ledger. Accept this estimate when the customer approves it.'}
                </p>
              )}

              {selected.notes ? <p className="report-note">{selected.notes}</p> : null}
            </section>
          ) : null}
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="estimate-form"
        aria-label={editing ? 'Edit estimate' : 'New estimate'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
              <path d="M14 3v6h6M8 13h8M8 17h5" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit estimate' : 'New estimate'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close estimate form"
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
          <label className="drawer-form__label" htmlFor="estimate-customer">
            Customer
          </label>
          <select
            id="estimate-customer"
            required
            value={form.customerId}
            onChange={(event) => setField('customerId', event.target.value)}
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
              <label className="drawer-form__label" htmlFor="estimate-issue-date">
                Issue date
              </label>
              <input
                id="estimate-issue-date"
                type="date"
                required
                value={form.issueDate}
                onChange={(event) => setField('issueDate', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="estimate-expiry-date">
                Expires
              </label>
              <input
                id="estimate-expiry-date"
                type="date"
                value={form.expiryDate}
                onChange={(event) => setField('expiryDate', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__label" htmlFor="estimate-tax-rate">
            Tax rate (%)
          </label>
          <input
            id="estimate-tax-rate"
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
                <div>
                  <label className="drawer-form__label" htmlFor={`estimate-item-${line.key}`}>
                    Line {index + 1} item
                  </label>
                  <select
                    id={`estimate-item-${line.key}`}
                    required
                    value={line.itemId}
                    onChange={(event) => chooseItem(line, event.target.value)}
                  >
                    <option value="">Choose an item</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.active ? '' : ' (inactive)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="invoice-form__numbers">
                  <div>
                    <label className="drawer-form__label" htmlFor={`estimate-qty-${line.key}`}>
                      Line {index + 1} quantity
                    </label>
                    <input
                      id={`estimate-qty-${line.key}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="drawer-form__label" htmlFor={`estimate-rate-${line.key}`}>
                      Line {index + 1} rate
                    </label>
                    <input
                      id={`estimate-rate-${line.key}`}
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
                    <span>{money(lineAmount(line, items))}</span>
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

          <label className="drawer-form__label" htmlFor="estimate-notes">
            Notes
          </label>
          <input
            id="estimate-notes"
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
              {editing ? 'Save estimate' : 'Create estimate'}
            </button>
            <span className="drawer-form__hint">
              Estimates never post. Converting creates a draft invoice.
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
