'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Customer,
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  Item,
  OrgSettings,
  Project,
  clearSession,
  createInvoice,
  downloadInvoicePdf,
  fetchActiveOrganization,
  fetchCustomers,
  fetchInvoice,
  fetchInvoices,
  fetchItems,
  fetchProjects,
  fetchSettings,
  getAccessToken,
  getActiveOrgId,
  sendInvoice,
  setActiveOrgId,
  updateInvoice,
} from '@/lib/api';

type Filter = 'ALL' | InvoiceStatus;

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
  unitPrice: string;
}

interface InvoiceForm {
  customerId: string;
  projectId: string;
  issueDate: string;
  dueDate: string;
  taxRate: string;
  notes: string;
  lines: DraftLine[];
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' },
];

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  DRAFT: 'status--draft',
  SENT: 'status--sent',
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

export default function InvoicesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [form, setForm] = useState<InvoiceForm>(() => ({
    customerId: '',
    projectId: '',
    issueDate: today(),
    dueDate: addDays(today(), 30),
    taxRate: '0',
    notes: '',
    lines: [blankLine()],
  }));
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
      const [orgSettings, customerRows, itemRows, projectRows, invoiceRows] =
        await Promise.all([
          fetchSettings(activeOrg.organizationId),
          fetchCustomers(activeOrg.organizationId),
          fetchItems(activeOrg.organizationId),
          fetchProjects(activeOrg.organizationId),
          fetchInvoices(activeOrg.organizationId),
        ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setSettings(orgSettings);
      setCustomers(customerRows);
      setItems(itemRows);
      setProjects(projectRows);
      setInvoices(invoiceRows);
      const linkedId = new URLSearchParams(window.location.search).get('invoice');
      const linked = linkedId
        ? invoiceRows.find((invoice) => invoice.id === linkedId)
        : undefined;
      if (linked) {
        setSelected(linked);
        window.setTimeout(() => {
          document.getElementById('invoice-detail')?.scrollIntoView({ block: 'start' });
        }, 0);
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
      const rows = await fetchInvoices(org.organizationId, {
        search: search.trim() || undefined,
      });
      setInvoices(rows);
      setSelected((current) => {
        if (!current) return null;
        return rows.find((invoice) => invoice.id === current.id) ?? current;
      });
      setError(null);
    } catch {
      setError('The invoice book is not available right now.');
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

  const visibleInvoices = useMemo(() => {
    if (!invoices) return null;
    return filter === 'ALL' ? invoices : invoices.filter((invoice) => invoice.status === filter);
  }, [invoices, filter]);

  const summary = useMemo(() => {
    const rows = invoices ?? [];
    const outstanding = rows
      .filter((invoice) => ['SENT', 'PARTIAL', 'OVERDUE'].includes(invoice.status))
      .reduce((sum, invoice) => sum + invoice.balanceDue, 0);
    const overdue = rows
      .filter((invoice) => invoice.status === 'OVERDUE')
      .reduce((sum, invoice) => sum + invoice.balanceDue, 0);
    const drafts = rows.filter((invoice) => invoice.status === 'DRAFT').length;
    return { outstanding, overdue, drafts };
  }, [invoices]);

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
      projectId: '',
      issueDate,
      dueDate: addDays(issueDate, 30),
      taxRate: String(Number(((settings?.defaultTaxRate ?? 0) * 100).toFixed(4))),
      notes: '',
      lines: [line],
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(invoice: Invoice) {
    setEditing(invoice);
    setForm({
      customerId: invoice.customerId,
      projectId: invoice.projectId ?? '',
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      taxRate: String(Number((invoice.taxRate * 100).toFixed(4))),
      notes: invoice.notes ?? '',
      lines: invoice.lines.map((line) => ({
        key: nextLineKey++,
        itemId: line.itemId,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      })),
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof InvoiceForm>(field: K, value: InvoiceForm[K]) {
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
      setFormError('Choose a customer for this invoice.');
      return;
    }
    if (form.lines.some((line) => !line.itemId || Number(line.quantity) <= 0)) {
      setFormError('Every line needs an item and a quantity above zero.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload: InvoiceInput = {
        customerId: form.customerId,
        projectId: form.projectId,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        taxRate: Number(form.taxRate) / 100,
        notes: form.notes.trim() || undefined,
        lines: form.lines.map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
      };
      const saved = editing
        ? await updateInvoice(org.organizationId, editing.id, payload)
        : await createInvoice(org.organizationId, payload);
      setSelected(saved);
      setFormOpen(false);
      setFilter('ALL');
      setSearch('');
      await load();
      showToast(editing ? `${saved.number} updated.` : `${saved.number} drafted.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that invoice');
    } finally {
      setBusy(false);
    }
  }

  async function onSend(invoice: Invoice) {
    if (!org || busy) return;
    setBusy(true);
    try {
      const saved = await sendInvoice(org.organizationId, invoice.id);
      setSelected(await fetchInvoice(org.organizationId, saved.id));
      await load();
      showToast(`${saved.number} sent and posted to the ledger.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invoice');
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(invoice: Invoice) {
    if (!org || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await downloadInvoicePdf(org.organizationId, invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`${invoice.number} downloaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download that invoice');
    } finally {
      setDownloading(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the invoice book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="invoices" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Invoices</h1>
              <p className="page-head__meta">
                {invoices?.length ?? 0} invoices. {money(summary.outstanding)} outstanding.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New invoice
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Outstanding</div>
              <div className="stat__value">{money(summary.outstanding)}</div>
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

          <section className="invoice-list" aria-labelledby="invoice-list-title">
            <h2 className="sr-only" id="invoice-list-title">
              Invoice list
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search invoices</span>
                <input
                  type="search"
                  aria-label="Search invoices"
                  placeholder="Search by number or customer"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">Draft work stays off the ledger until it is sent.</p>
            </div>

            <div className="filters" role="group" aria-label="Filter invoices">
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
              <table className="data-table invoice-table">
                <caption className="sr-only">Invoices with status and amount due</caption>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Customer</th>
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
                  {visibleInvoices === null ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : visibleInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        No invoices in this view.
                      </td>
                    </tr>
                  ) : (
                    visibleInvoices.map((invoice) => (
                      <tr
                        key={invoice.id}
                        className={`invoice-row is-clickable${
                          selected?.id === invoice.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelected(invoice)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(invoice);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {invoice.number}
                          </button>
                        </td>
                        <td>{invoice.customer.name}</td>
                        <td>{displayDate(invoice.issueDate)}</td>
                        <td>{displayDate(invoice.dueDate)}</td>
                        <td>
                          <span className={`status ${STATUS_CLASS[invoice.status]}`}>
                            <span className="dot"></span>
                            {invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                        <td className="num">{money(invoice.total)}</td>
                        <td className="num">{money(invoice.balanceDue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selected ? (
            <section className="invoice-detail" id="invoice-detail" aria-labelledby="detail-number">
              <div className="invoice-detail__head">
                <div>
                  <h2 id="detail-number">Invoice {selected.number}</h2>
                  <p className="invoice-detail__meta">
                    Issued {displayDate(selected.issueDate)}. Due{' '}
                    {displayDate(selected.dueDate)}.{' '}
                    <span className={`status ${STATUS_CLASS[selected.status]}`}>
                      <span className="dot"></span>
                      {selected.status.charAt(0) + selected.status.slice(1).toLowerCase()}
                    </span>
                    {selected.status === 'OVERDUE' ? (
                      <> {selected.daysOverdue} days overdue.</>
                    ) : null}
                    {selected.project ? (
                      <>
                        {' '}·{' '}
                        <a className="invoice-link" href={`/projects?project=${selected.project.id}`}>
                          {selected.project.code} · {selected.project.name}
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  <button
                    className="btn btn--outline"
                    type="button"
                    disabled={downloading}
                    onClick={() => void onDownload(selected)}
                  >
                    {downloading ? 'Preparing PDF…' : 'Download PDF'}
                  </button>
                  {editable && selected.status === 'DRAFT' ? (
                    <>
                      <button
                        className="btn btn--outline"
                        type="button"
                        onClick={() => openEdit(selected)}
                      >
                        Edit invoice
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void onSend(selected)}
                      >
                        Mark as sent
                      </button>
                    </>
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
                  <div className="party-label">Bill to</div>
                  <div className="party-name">{selected.customer.name}</div>
                  {selected.customer.contactName ? (
                    <div className="party-line">{selected.customer.contactName}</div>
                  ) : null}
                  {[selected.customer.addressLine1, selected.customer.addressLine2]
                    .filter(Boolean)
                    .map((line) => (
                      <div className="party-line" key={line}>
                        {line}
                      </div>
                    ))}
                  {[selected.customer.city, selected.customer.region, selected.customer.postalCode]
                    .filter(Boolean)
                    .length > 0 ? (
                    <div className="party-line">
                      {[selected.customer.city, selected.customer.region, selected.customer.postalCode]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
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
                <caption className="sr-only">Invoice line items</caption>
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

              {selected.lines.some((line) => line.timeEntry) ? (
                <div className="invoice-time">
                  <div className="timeline__title">Time rolled up</div>
                  <table className="line-table">
                    <caption className="sr-only">Time entries billed on this invoice</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Member</th>
                        <th scope="col" className="num">
                          Hours
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
                      {selected.lines
                        .filter((line) => line.timeEntry)
                        .map((line) => (
                          <tr key={line.timeEntry!.id}>
                            <td>{displayDate(line.timeEntry!.date)}</td>
                            <td>{line.timeEntry!.user.name}</td>
                            <td className="num">{line.timeEntry!.hours}</td>
                            <td className="num">{money(line.timeEntry!.rate)}</td>
                            <td className="num">{money(line.timeEntry!.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="report-note">
                    Billed from time entries; each line links back to its project time.
                  </p>
                </div>
              ) : null}

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
                  ? 'Draft, not sent. Sending posts the receivable, income, and tax to the ledger.'
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
                  <div className={`timeline__item${selected.sentAt ? ' is-done' : ''}`}>
                    <div className="timeline__date">
                      {selected.sentAt ? displayDate(selected.sentAt.slice(0, 10)) : 'Not sent'}
                    </div>
                    <div className="timeline__label">Sent</div>
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
        id="invoice-form"
        aria-label={editing ? 'Edit invoice' : 'New invoice'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
              <path d="M14 3v6h6M8 13h8M8 17h5" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit invoice' : 'New invoice'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close invoice form"
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
          <label className="drawer-form__label" htmlFor="invoice-customer">
            Customer
          </label>
          <select
            id="invoice-customer"
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

          <label className="drawer-form__label" htmlFor="invoice-project">
            Project
          </label>
          <select
            id="invoice-project"
            value={form.projectId}
            onChange={(event) => setField('projectId', event.target.value)}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
                {project.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="invoice-issue-date">
                Issue date
              </label>
              <input
                id="invoice-issue-date"
                type="date"
                required
                value={form.issueDate}
                onChange={(event) => setField('issueDate', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="invoice-due-date">
                Due date
              </label>
              <input
                id="invoice-due-date"
                type="date"
                required
                value={form.dueDate}
                onChange={(event) => setField('dueDate', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__label" htmlFor="invoice-tax-rate">
            Tax rate (%)
          </label>
          <input
            id="invoice-tax-rate"
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
                  <label className="drawer-form__label" htmlFor={`invoice-item-${line.key}`}>
                    Line {index + 1} item
                  </label>
                  <select
                    id={`invoice-item-${line.key}`}
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
                    <label className="drawer-form__label" htmlFor={`invoice-qty-${line.key}`}>
                      Line {index + 1} quantity
                    </label>
                    <input
                      id={`invoice-qty-${line.key}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="drawer-form__label" htmlFor={`invoice-rate-${line.key}`}>
                      Line {index + 1} rate
                    </label>
                    <input
                      id={`invoice-rate-${line.key}`}
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

          <label className="drawer-form__label" htmlFor="invoice-notes">
            Notes
          </label>
          <input
            id="invoice-notes"
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
              {editing ? 'Save invoice' : 'Create draft'}
            </button>
            <span className="drawer-form__hint">
              Drafts do not post. Sending posts receivable, income, and tax.
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
