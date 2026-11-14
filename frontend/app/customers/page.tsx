'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Customer,
  CustomerInput,
  clearSession,
  createCustomer,
  fetchActiveOrganization,
  fetchCustomers,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  updateCustomer,
} from '@/lib/api';

interface CustomerForm {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
  active: boolean;
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  notes: '',
  active: true,
};

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

export default function CustomersPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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
      setCustomers(
        await fetchCustomers(org.organizationId, { search: search.trim() || undefined }),
      );
      setError(null);
    } catch {
      setError('The customer list is not available right now.');
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
      setDetailOpen(false);
      setFormOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditing(customer);
    setForm({
      name: customer.name,
      contactName: customer.contactName ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      addressLine1: customer.addressLine1 ?? '',
      addressLine2: customer.addressLine2 ?? '',
      city: customer.city ?? '',
      region: customer.region ?? '',
      postalCode: customer.postalCode ?? '',
      country: customer.country ?? '',
      notes: customer.notes ?? '',
      active: customer.active,
    });
    setFormError(null);
    setDetailOpen(false);
    setFormOpen(true);
  }

  function setField<K extends keyof CustomerForm>(field: K, value: CustomerForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function detailLine(label: string, value: string | null): string | null {
    return value && value.trim() ? value : null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const optional = (value: string): string | undefined => value.trim() || undefined;
      const payload: CustomerInput = {
        name: form.name.trim(),
        contactName: optional(form.contactName),
        email: optional(form.email),
        phone: optional(form.phone),
        addressLine1: optional(form.addressLine1),
        addressLine2: optional(form.addressLine2),
        city: optional(form.city),
        region: optional(form.region),
        postalCode: optional(form.postalCode),
        country: optional(form.country),
        notes: optional(form.notes),
      };

      if (editing) {
        const saved = await updateCustomer(org.organizationId, editing.id, {
          ...payload,
          active: form.active,
        });
        showToast(`${saved.name} updated.`);
      } else {
        const saved = await createCustomer(org.organizationId, payload);
        showToast(`${saved.name} added.`);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that customer');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the customer book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="customers" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Customers</h1>
              <p className="page-head__meta">
                {org?.organizationName}. {customers?.length ?? 0} customers, balances derived from
                sales.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New customer
                </button>
              </div>
            ) : null}
          </header>

          <section className="section" aria-labelledby="customer-list-title">
            <div className="master-toolbar">
              <label className="search-field">
                <span className="sr-only">Search customers</span>
                <input
                  type="search"
                  aria-label="Search customers"
                  placeholder="Search by name, code, or email"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">Open a customer to see contact details and balance.</p>
            </div>

            <h2 className="sr-only" id="customer-list-title">
              Customer list
            </h2>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-wrap">
              <table className="data-table customers-table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Email</th>
                    <th scope="col">Phone</th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {customers === null ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        No customers match this search.
                      </td>
                    </tr>
                  ) : (
                    customers.map((customer) => (
                      <tr
                        key={customer.id}
                        className={`is-clickable${customer.active ? '' : ' is-inactive'}`}
                        onClick={() => {
                          setSelected(customer);
                          setDetailOpen(true);
                        }}
                      >
                        <td className="accounts-code">{customer.code}</td>
                        <td>{customer.name}</td>
                        <td>{customer.contactName ?? '—'}</td>
                        <td>{customer.email ?? '—'}</td>
                        <td>{customer.phone ?? '—'}</td>
                        <td className="num customer-balance">{money(customer.balance)}</td>
                        <td>
                          <span
                            className={`status ${
                              customer.active ? 'status--green' : 'status--amber'
                            }`}
                          >
                            <span className="dot"></span>
                            {customer.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="accounts-note">
              Balances are derived from invoices and payments; they are never edited by hand.
            </p>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${detailOpen ? ' is-open' : ''}`}
        id="customer-detail"
        aria-label="Customer detail"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
            </svg>
          </span>
          <h2 className="margin__title">{selected?.name ?? 'Customer'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close customer detail"
            onClick={() => setDetailOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {selected ? (
          <>
            <dl className="drawer-read">
              <dt>Balance</dt>
              <dd className="detail-figure">{money(selected.balance)}</dd>
              <dt>Customer number</dt>
              <dd>{selected.code}</dd>
              {detailLine('Contact', selected.contactName) ? (
                <>
                  <dt>Contact</dt>
                  <dd>{selected.contactName}</dd>
                </>
              ) : null}
              {detailLine('Email', selected.email) ? (
                <>
                  <dt>Email</dt>
                  <dd>{selected.email}</dd>
                </>
              ) : null}
              {detailLine('Phone', selected.phone) ? (
                <>
                  <dt>Phone</dt>
                  <dd>{selected.phone}</dd>
                </>
              ) : null}
              {[selected.addressLine1, selected.addressLine2].some((line) => line && line.trim()) ||
              [selected.city, selected.region, selected.postalCode, selected.country].some(
                (line) => line && line.trim(),
              ) ? (
                <>
                  <dt>Billing address</dt>
                  <dd>
                    {[selected.addressLine1, selected.addressLine2].filter(Boolean).join(', ')}
                    {selected.addressLine1 || selected.addressLine2 ? <br /> : null}
                    {[selected.city, selected.region, selected.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                    {selected.country ? <br /> : null}
                    {selected.country}
                  </dd>
                </>
              ) : null}
              {detailLine('Notes', selected.notes) ? (
                <>
                  <dt>Notes</dt>
                  <dd>{selected.notes}</dd>
                </>
              ) : null}
              <dt>Status</dt>
              <dd>{selected.active ? 'Active' : 'Inactive'}</dd>
            </dl>

            {editable ? (
              <div className="entry-actions">
                <button
                  className="btn btn--outline btn--sm"
                  type="button"
                  onClick={() => openEdit(selected)}
                >
                  Edit customer
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => setDetailOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </aside>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="customer-form"
        aria-label={editing ? 'Edit customer' : 'New customer'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit customer' : 'New customer'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close customer form"
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
          <label className="drawer-form__label" htmlFor="customer-name">
            Name
          </label>
          <input
            id="customer-name"
            required
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="customer-contact">
            Contact name
          </label>
          <input
            id="customer-contact"
            value={form.contactName}
            onChange={(event) => setField('contactName', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="customer-email">
            Email
          </label>
          <input
            id="customer-email"
            type="email"
            value={form.email}
            onChange={(event) => setField('email', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="customer-phone">
            Phone
          </label>
          <input
            id="customer-phone"
            value={form.phone}
            onChange={(event) => setField('phone', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="customer-address1">
            Address line 1
          </label>
          <input
            id="customer-address1"
            value={form.addressLine1}
            onChange={(event) => setField('addressLine1', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="customer-address2">
            Address line 2
          </label>
          <input
            id="customer-address2"
            value={form.addressLine2}
            onChange={(event) => setField('addressLine2', event.target.value)}
          />

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="customer-city">
                City
              </label>
              <input
                id="customer-city"
                value={form.city}
                onChange={(event) => setField('city', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="customer-region">
                Region
              </label>
              <input
                id="customer-region"
                value={form.region}
                onChange={(event) => setField('region', event.target.value)}
              />
            </div>
          </div>

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="customer-postal">
                Postal code
              </label>
              <input
                id="customer-postal"
                value={form.postalCode}
                onChange={(event) => setField('postalCode', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="customer-country">
                Country
              </label>
              <input
                id="customer-country"
                value={form.country}
                onChange={(event) => setField('country', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__label" htmlFor="customer-notes">
            Notes
          </label>
          <input
            id="customer-notes"
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
          />

          {editing ? (
            <label className="accounts-toggle accounts-toggle--drawer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setField('active', event.target.checked)}
              />
              Customer is active
            </label>
          ) : null}

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editing ? 'Save customer' : 'Add customer'}
            </button>
            <span className="drawer-form__hint">
              Customers are never deleted; deactivate them to retire the record.
            </span>
          </div>
        </form>
      </aside>

      <div
        className={`scrim${formOpen || detailOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => {
          setFormOpen(false);
          setDetailOpen(false);
        }}
      ></div>
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
