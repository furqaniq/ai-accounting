'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  Account,
  ActiveOrganization,
  Item,
  clearSession,
  createItem,
  fetchAccounts,
  fetchActiveOrganization,
  fetchItems,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  updateItem,
} from '@/lib/api';

interface ItemForm {
  name: string;
  description: string;
  price: string;
  incomeAccountId: string;
  taxable: boolean;
  active: boolean;
}

const EMPTY_FORM: ItemForm = {
  name: '',
  description: '',
  price: '',
  incomeAccountId: '',
  taxable: true,
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

export default function ItemsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
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
      const chart = await fetchAccounts(activeOrg.organizationId);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setAccounts(chart);
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

  const incomeAccounts = accounts.filter(
    (account) =>
      account.type === 'INCOME' && (account.active || account.id === editing?.incomeAccountId),
  );

  const load = useCallback(async () => {
    if (!org) return;
    try {
      setItems(await fetchItems(org.organizationId, { search: search.trim() || undefined }));
      setError(null);
    } catch {
      setError('The item catalog is not available right now.');
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
      if (event.key === 'Escape') setFormOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, incomeAccountId: incomeAccounts[0]?.id ?? '' });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description ?? '',
      price: item.price.toFixed(2),
      incomeAccountId: item.incomeAccountId,
      taxable: item.taxable,
      active: item.active,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof ItemForm>(field: K, value: ItemForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        price: Number(form.price),
        incomeAccountId: form.incomeAccountId,
        taxable: form.taxable,
      };
      if (editing) {
        const saved = await updateItem(org.organizationId, editing.id, {
          ...payload,
          description: form.description.trim(),
          active: form.active,
        });
        showToast(`${saved.name} updated.`);
      } else {
        const saved = await createItem(org.organizationId, payload);
        showToast(`${saved.name} added to the catalog.`);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that item');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the item catalog…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="items" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Items</h1>
              <p className="page-head__meta">
                {org?.organizationName}. {items?.length ?? 0} items in the catalog.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreate}>
                  New item
                </button>
              </div>
            ) : null}
          </header>

          <section className="section" aria-labelledby="item-list-title">
            <div className="master-toolbar">
              <label className="search-field">
                <span className="sr-only">Search items</span>
                <input
                  type="search"
                  aria-label="Search items"
                  placeholder="Search by name, code, or description"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <p className="section__meta">
                Invoice and estimate lines draw from this catalog.
              </p>
            </div>

            <h2 className="sr-only" id="item-list-title">
              Item list
            </h2>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-wrap">
              <table className="data-table items-table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Item</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="num">
                      Price
                    </th>
                    <th scope="col">Income account</th>
                    <th scope="col">Taxable</th>
                    <th scope="col">Status</th>
                    {editable ? (
                      <th scope="col" className="sr-only">
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items === null ? (
                    <tr>
                      <td colSpan={editable ? 8 : 7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={editable ? 8 : 7} className="accounts-empty">
                        No items match this search.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className={item.active ? undefined : 'is-inactive'}>
                        <td className="accounts-code">{item.code}</td>
                        <td>{item.name}</td>
                        <td>{item.description ?? '—'}</td>
                        <td className="num price">{money(item.price)}</td>
                        <td>
                          {item.incomeAccount.code} — {item.incomeAccount.name}
                        </td>
                        <td>{item.taxable ? 'Yes' : 'No'}</td>
                        <td>
                          <span
                            className={`status ${
                              item.active ? 'status--green' : 'status--amber'
                            }`}
                          >
                            <span className="dot"></span>
                            {item.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {editable ? (
                          <td className="num">
                            <button
                              className="btn btn--ghost btn--sm"
                              type="button"
                              aria-label={`Edit ${item.name}`}
                              onClick={() => openEdit(item)}
                            >
                              Edit
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="accounts-note">
              Prices are the default for new invoice lines and stay editable on each line.
            </p>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${formOpen ? ' is-open' : ''}`}
        id="item-form"
        aria-label={editing ? 'Edit item' : 'New item'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
              <path d="M4 7.5 12 12l8-4.5M12 12v9" />
            </svg>
          </span>
          <h2 className="margin__title">{editing ? 'Edit item' : 'New item'}</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close item form"
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
          <label className="drawer-form__label" htmlFor="item-name">
            Name
          </label>
          <input
            id="item-name"
            required
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="item-description">
            Description
          </label>
          <input
            id="item-description"
            value={form.description}
            onChange={(event) => setField('description', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="item-price">
            Price
          </label>
          <input
            id="item-price"
            required
            inputMode="decimal"
            value={form.price}
            onChange={(event) => setField('price', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="item-income-account">
            Income account
          </label>
          <select
            id="item-income-account"
            required
            value={form.incomeAccountId}
            onChange={(event) => setField('incomeAccountId', event.target.value)}
          >
            <option value="">Select an income account</option>
            {incomeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>

          <label className="accounts-toggle accounts-toggle--drawer">
            <input
              type="checkbox"
              checked={form.taxable}
              onChange={(event) => setField('taxable', event.target.checked)}
            />
            Taxable
          </label>

          {editing ? (
            <label className="accounts-toggle">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setField('active', event.target.checked)}
              />
              Item is active
            </label>
          ) : null}

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editing ? 'Save item' : 'Add item'}
            </button>
            <span className="drawer-form__hint">
              Only income accounts from this book can receive item revenue.
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
