'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  Customer,
  Item,
  OrgSettings,
  Project,
  ProjectDetail,
  clearSession,
  createProject,
  createTimeEntry,
  deleteTimeEntry,
  fetchActiveOrganization,
  fetchCustomers,
  fetchItems,
  fetchProject,
  fetchProjects,
  fetchSettings,
  getAccessToken,
  getActiveOrgId,
  rollupTimeEntries,
  setActiveOrgId,
  updateProject,
} from '@/lib/api';

interface ProjectForm {
  name: string;
  description: string;
  customerId: string;
  billingItemId: string;
  defaultRate: string;
  active: boolean;
}

interface TimeForm {
  projectId: string;
  date: string;
  hours: string;
  rate: string;
  billable: boolean;
  notes: string;
}

interface RollupForm {
  customerId: string;
  billingItemId: string;
  issueDate: string;
  dueDate: string;
  taxRate: string;
  notes: string;
}

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

function hours(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function blankProjectForm(): ProjectForm {
  return {
    name: '',
    description: '',
    customerId: '',
    billingItemId: '',
    defaultRate: '',
    active: true,
  };
}

function blankTimeForm(project: Project | null): TimeForm {
  return {
    projectId: project?.id ?? '',
    date: today(),
    hours: '',
    rate: project?.defaultRate !== null && project?.defaultRate !== undefined
      ? String(project.defaultRate)
      : '',
    billable: true,
    notes: '',
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectForm>(blankProjectForm);
  const [timeFormOpen, setTimeFormOpen] = useState(false);
  const [timeForm, setTimeForm] = useState<TimeForm>(() => blankTimeForm(null));
  const [rollupOpen, setRollupOpen] = useState(false);
  const [rollupForm, setRollupForm] = useState<RollupForm>(() => ({
    customerId: '',
    billingItemId: '',
    issueDate: today(),
    dueDate: addDays(today(), 30),
    taxRate: '0',
    notes: '',
  }));
  const [rollupEntryIds, setRollupEntryIds] = useState<string[]>([]);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; number: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [rollupError, setRollupError] = useState<string | null>(null);
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
      const [orgSettings, customerRows, itemRows, projectRows] = await Promise.all([
        fetchSettings(activeOrg.organizationId),
        fetchCustomers(activeOrg.organizationId),
        fetchItems(activeOrg.organizationId),
        fetchProjects(activeOrg.organizationId),
      ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setSettings(orgSettings);
      setCustomers(customerRows);
      setItems(itemRows);
      setProjects(projectRows);
      const linked = new URLSearchParams(window.location.search).get('project');
      const initialProject =
        projectRows.find((project) => project.id === linked) ?? projectRows[0];
      if (initialProject) setSelectedId(initialProject.id);
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

  const loadProjects = useCallback(async () => {
    if (!org) return;
    try {
      const rows = await fetchProjects(org.organizationId, {
        search: search.trim() || undefined,
        active: showInactive ? undefined : true,
      });
      setProjects(rows);
      setSelectedId((current) => {
        if (current && rows.some((project) => project.id === current)) return current;
        return rows[0]?.id ?? null;
      });
      setError(null);
    } catch {
      setError('The project book is not available right now.');
    }
  }, [org, search, showInactive]);

  useEffect(() => {
    if (!org) return;
    const timer = window.setTimeout(() => {
      void loadProjects();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadProjects, org]);

  const loadDetail = useCallback(async () => {
    if (!org || !selectedId) {
      setDetail(null);
      return;
    }
    try {
      const row = await fetchProject(org.organizationId, selectedId);
      setDetail(row);
      setError(null);
    } catch {
      setDetail(null);
      setError('That project is not available right now.');
    }
  }, [org, selectedId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function refreshAll() {
    await loadProjects();
    await loadDetail();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setProjectFormOpen(false);
      setTimeFormOpen(false);
      setRollupOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const summary = useMemo(() => {
    const rows = projects ?? [];
    return {
      count: rows.length,
      revenue: rows.reduce((sum, project) => sum + project.profitability.revenue, 0),
      profit: rows.reduce((sum, project) => sum + project.profitability.profit, 0),
      unbilled: rows.reduce(
        (sum, project) => sum + project.profitability.unbilledValue,
        0,
      ),
    };
  }, [projects]);

  const uninvoicedEntries = useMemo(
    () =>
      (detail?.timeEntries ?? []).filter(
        (entry) => entry.billable && !entry.invoice,
      ),
    [detail],
  );

  const rollupTotal = useMemo(
    () =>
      uninvoicedEntries
        .filter((entry) => rollupEntryIds.includes(entry.id))
        .reduce((sum, entry) => sum + entry.amount, 0),
    [uninvoicedEntries, rollupEntryIds],
  );

  function openCreateProject() {
    setEditingProject(null);
    setProjectForm(blankProjectForm());
    setFormError(null);
    setProjectFormOpen(true);
  }

  function openEditProject(project: Project) {
    setEditingProject(project);
    setProjectForm({
      name: project.name,
      description: project.description ?? '',
      customerId: project.customerId ?? '',
      billingItemId: project.billingItemId ?? '',
      defaultRate: project.defaultRate === null ? '' : String(project.defaultRate),
      active: project.active,
    });
    setFormError(null);
    setProjectFormOpen(true);
  }

  function setProjectField<K extends keyof ProjectForm>(
    field: K,
    value: ProjectForm[K],
  ) {
    setProjectForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (!projectForm.name.trim()) {
      setFormError('Give the project a name.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const payload = {
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
        customerId: projectForm.customerId,
        billingItemId: projectForm.billingItemId,
        defaultRate:
          projectForm.defaultRate === ''
            ? editingProject
              ? null
              : undefined
            : Number(projectForm.defaultRate),
        active: projectForm.active,
      };
      const saved = editingProject
        ? await updateProject(org.organizationId, editingProject.id, payload)
        : await createProject(org.organizationId, payload);
      setProjectFormOpen(false);
      setSelectedId(saved.id);
      await refreshAll();
      showToast(editingProject ? `${saved.code} updated.` : `${saved.code} created.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that project');
    } finally {
      setBusy(false);
    }
  }

  function openAddTime(project: Project | null) {
    setTimeForm(blankTimeForm(project));
    setTimeError(null);
    setTimeFormOpen(true);
  }

  function setTimeField<K extends keyof TimeForm>(field: K, value: TimeForm[K]) {
    setTimeForm((current) => ({ ...current, [field]: value }));
  }

  function chooseTimeProject(projectId: string) {
    const project = projects?.find((row) => row.id === projectId);
    setTimeForm((current) => ({
      ...current,
      projectId,
      rate:
        current.rate === '' && project?.defaultRate !== null && project?.defaultRate !== undefined
          ? String(project.defaultRate)
          : current.rate,
    }));
  }

  async function onSubmitTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    const hoursValue = Number(timeForm.hours);
    if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
      setTimeError('Enter hours greater than zero.');
      return;
    }
    if (!timeForm.projectId && timeForm.rate === '') {
      setTimeError('Choose a project or enter a rate.');
      return;
    }
    setBusy(true);
    setTimeError(null);
    try {
      await createTimeEntry(org.organizationId, {
        projectId: timeForm.projectId || undefined,
        date: timeForm.date,
        hours: hoursValue,
        rate: timeForm.rate === '' ? undefined : Number(timeForm.rate),
        billable: timeForm.billable,
        notes: timeForm.notes.trim() || undefined,
      });
      setTimeFormOpen(false);
      await refreshAll();
      showToast('Time entry added.');
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : 'Could not save that time entry');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteTime(timeEntryId: string) {
    if (!org || busy) return;
    setBusy(true);
    try {
      await deleteTimeEntry(org.organizationId, timeEntryId);
      await refreshAll();
      showToast('Time entry removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that time entry');
    } finally {
      setBusy(false);
    }
  }

  function openRollup() {
    if (!detail || uninvoicedEntries.length === 0) {
      showToast('No uninvoiced billable time to bill.');
      return;
    }
    setRollupEntryIds(uninvoicedEntries.map((entry) => entry.id));
    setRollupForm({
      customerId: detail.project.customerId ?? '',
      billingItemId: detail.project.billingItemId ?? '',
      issueDate: today(),
      dueDate: addDays(today(), 30),
      taxRate: String(Number(((settings?.defaultTaxRate ?? 0) * 100).toFixed(4))),
      notes: '',
    });
    setRollupError(null);
    setRollupOpen(true);
  }

  function setRollupField<K extends keyof RollupForm>(
    field: K,
    value: RollupForm[K],
  ) {
    setRollupForm((current) => ({ ...current, [field]: value }));
  }

  function toggleRollupEntry(id: string) {
    setRollupEntryIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function onSubmitRollup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || busy) return;
    if (rollupEntryIds.length === 0) {
      setRollupError('Select at least one uninvoiced time entry.');
      return;
    }
    setBusy(true);
    setRollupError(null);
    try {
      const result = await rollupTimeEntries(org.organizationId, {
        entryIds: rollupEntryIds,
        customerId: rollupForm.customerId || undefined,
        billingItemId: rollupForm.billingItemId || undefined,
        issueDate: rollupForm.issueDate,
        dueDate: rollupForm.dueDate,
        taxRate: rollupForm.taxRate === '' ? undefined : Number(rollupForm.taxRate) / 100,
        notes: rollupForm.notes.trim() || undefined,
      });
      setRollupOpen(false);
      setLastInvoice({ id: result.invoice.id, number: result.invoice.number });
      await refreshAll();
      showToast(`${result.invoice.number} drafted from billed time.`);
    } catch (err) {
      setRollupError(err instanceof Error ? err.message : 'Could not bill that time');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Turning to the project book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');
  const projectRows = projects ?? [];

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="projects" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Projects</h1>
              <p className="page-head__meta">
                {summary.count} {summary.count === 1 ? 'project' : 'projects'}.{' '}
                {money(summary.unbilled)} unbilled time.
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--primary" type="button" onClick={openCreateProject}>
                  New project
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Tagged revenue</div>
              <div className="stat__value">{money(summary.revenue)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Project profit</div>
              <div className={`stat__value${summary.profit < 0 ? ' is-negative' : ''}`}>
                {money(summary.profit)}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">Unbilled time</div>
              <div className="stat__value">{money(summary.unbilled)}</div>
            </div>
          </div>

          <section className="invoice-list" aria-labelledby="project-list-title">
            <h2 className="sr-only" id="project-list-title">
              Project list
            </h2>

            <div className="master-toolbar invoice-toolbar">
              <label className="search-field">
                <span className="sr-only">Search projects</span>
                <input
                  type="search"
                  aria-label="Search projects"
                  placeholder="Search project, code, or customer"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="project-filter">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show inactive
              </label>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table invoice-table project-table">
                <caption className="sr-only">
                  Projects with tagged revenue, expenses, profit, and unbilled time
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Customer</th>
                    <th scope="col" className="num">
                      Revenue
                    </th>
                    <th scope="col" className="num">
                      Expenses
                    </th>
                    <th scope="col" className="num">
                      Profit
                    </th>
                    <th scope="col" className="num">
                      Unbilled time
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects === null ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : projectRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="accounts-empty">
                        No projects in this view.
                      </td>
                    </tr>
                  ) : (
                    projectRows.map((project) => (
                      <tr
                        key={project.id}
                        className={`invoice-row is-clickable${
                          selectedId === project.id ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => {
                          setSelectedId(project.id);
                          setLastInvoice(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(project.id);
                            setLastInvoice(null);
                          }
                        }}
                      >
                        <td>
                          <button className="invoice-link" type="button">
                            {project.code} · {project.name}
                          </button>
                        </td>
                        <td>{project.customer?.name ?? '—'}</td>
                        <td className="num">{money(project.profitability.revenue)}</td>
                        <td className="num">{money(project.profitability.expenses)}</td>
                        <td className="num">{money(project.profitability.profit)}</td>
                        <td className="num">
                          {project.profitability.unbilledHours > 0
                            ? `${hours(project.profitability.unbilledHours)}h · ${money(
                                project.profitability.unbilledValue,
                              )}`
                            : '—'}
                        </td>
                        <td>
                          <span
                            className={`status ${
                              project.active ? 'status--sent' : 'status--draft'
                            }`}
                          >
                            <span className="dot"></span>
                            {project.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {detail ? (
            <section className="invoice-detail" id="project-detail" aria-labelledby="project-detail-title">
              <div className="invoice-detail__head">
                <div>
                  <h2 id="project-detail-title">
                    {detail.project.code} · {detail.project.name}
                  </h2>
                  <p className="invoice-detail__meta">
                    {detail.project.customer?.name ?? 'No customer'} ·{' '}
                    {detail.project.defaultRate !== null
                      ? `${money(detail.project.defaultRate)}/hr default`
                      : 'No default rate'}
                    {detail.project.billingItem
                      ? ` · bills as ${detail.project.billingItem.name}`
                      : ' · no billing item'}
                  </p>
                </div>
                <div className="invoice-detail__actions">
                  {editable ? (
                    <>
                      <button
                        className="btn btn--outline"
                        type="button"
                        onClick={() => openEditProject(detail.project)}
                      >
                        Edit project
                      </button>
                      <button
                        className="btn btn--outline"
                        type="button"
                        onClick={() => openAddTime(detail.project)}
                      >
                        Add time
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        disabled={uninvoicedEntries.length === 0}
                        onClick={openRollup}
                      >
                        Bill time
                      </button>
                    </>
                  ) : null}
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => {
                      setSelectedId(null);
                      setDetail(null);
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {lastInvoice ? (
                <p className="report-note">
                  Draft{' '}
                  <a className="invoice-link" href={`/invoices?invoice=${lastInvoice.id}`}>
                    {lastInvoice.number}
                  </a>{' '}
                  created from billed time. It stays off the ledger until it is sent.
                </p>
              ) : null}

              <div className="stats">
                <div className="stat">
                  <div className="stat__label">Revenue</div>
                  <div className="stat__value">{money(detail.project.profitability.revenue)}</div>
                </div>
                <div className="stat">
                  <div className="stat__label">Expenses</div>
                  <div className="stat__value">
                    {money(detail.project.profitability.expenses)}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat__label">Profit</div>
                  <div
                    className={`stat__value${
                      detail.project.profitability.profit < 0 ? ' is-negative' : ''
                    }`}
                  >
                    {money(detail.project.profitability.profit)}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat__label">Unbilled time</div>
                  <div className="stat__value">
                    {money(detail.project.profitability.unbilledValue)}
                  </div>
                </div>
              </div>

              <p className="report-note">
                {hours(detail.project.profitability.billableHours)} billable hours ·{' '}
                {hours(detail.project.profitability.invoicedHours)} invoiced ·{' '}
                {hours(detail.project.profitability.unbilledHours)} unbilled. Time value{' '}
                {money(detail.project.profitability.billableValue)} billable,{' '}
                {money(detail.project.profitability.invoicedValue)} invoiced.
              </p>

              <div className="project-section">
                <div className="timeline__title">Tagged invoices</div>
                {detail.invoices.length === 0 ? (
                  <p className="report-note">No invoices tagged to this project yet.</p>
                ) : (
                  <table className="line-table">
                    <caption className="sr-only">Invoices tagged to this project</caption>
                    <thead>
                      <tr>
                        <th scope="col">Invoice</th>
                        <th scope="col">Issued</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">
                          Subtotal
                        </th>
                        <th scope="col" className="num">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>
                            <a
                              className="invoice-link"
                              href={`/invoices?invoice=${invoice.id}`}
                            >
                              {invoice.number}
                            </a>
                          </td>
                          <td>{displayDate(invoice.issueDate)}</td>
                          <td>{invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}</td>
                          <td className="num">{money(invoice.subtotal)}</td>
                          <td className="num">{money(invoice.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="project-section">
                <div className="timeline__title">Tagged expenses</div>
                {detail.expenses.length === 0 ? (
                  <p className="report-note">No expenses tagged to this project yet.</p>
                ) : (
                  <table className="line-table">
                    <caption className="sr-only">Expenses tagged to this project</caption>
                    <thead>
                      <tr>
                        <th scope="col">Expense</th>
                        <th scope="col">Date</th>
                        <th scope="col">Category</th>
                        <th scope="col" className="num">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.expenses.map((expense) => (
                        <tr key={expense.id}>
                          <td>
                            <a
                              className="invoice-link"
                              href={`/expenses?expense=${expense.id}`}
                            >
                              {expense.number}
                            </a>
                          </td>
                          <td>{displayDate(expense.date)}</td>
                          <td>
                            {expense.categoryAccount.code} · {expense.categoryAccount.name}
                          </td>
                          <td className="num">{money(expense.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="project-section">
                <div className="invoice-form__lines-head">
                  <span className="timeline__title">Time</span>
                  {editable ? (
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      onClick={() => openAddTime(detail.project)}
                    >
                      Add time
                    </button>
                  ) : null}
                </div>
                {detail.timeEntries.length === 0 ? (
                  <p className="report-note">No time logged on this project yet.</p>
                ) : (
                  <table className="line-table project-time-table">
                    <caption className="sr-only">Time entries for this project</caption>
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
                        <th scope="col">Billing</th>
                        {editable ? <th scope="col">Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.timeEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{displayDate(entry.date)}</td>
                          <td>
                            {entry.user.name}
                            {entry.notes ? (
                              <div className="table-subline">{entry.notes}</div>
                            ) : null}
                          </td>
                          <td className="num">{hours(entry.hours)}</td>
                          <td className="num">{money(entry.rate)}</td>
                          <td className="num">{money(entry.amount)}</td>
                          <td>
                            {entry.invoice ? (
                              <a
                                className="invoice-link"
                                href={`/invoices?invoice=${entry.invoice.id}`}
                              >
                                {entry.invoice.number}
                              </a>
                            ) : entry.billable ? (
                              'Billable'
                            ) : (
                              'Non-billable'
                            )}
                          </td>
                          {editable ? (
                            <td>
                              {entry.invoice ? (
                                <span className="table-subline">On invoice</span>
                              ) : (
                                <button
                                  className="btn btn--ghost btn--sm"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void onDeleteTime(entry.id)}
                                >
                                  Remove
                                </button>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : (
            <section className="empty-state">
              <p className="report-note">
                {projectRows.length === 0
                  ? 'Create a project to tag invoices, expenses, and time.'
                  : 'Select a project to see profitability, tagged documents, and time.'}
              </p>
            </section>
          )}
        </main>
      </div>

      <aside
        className={`margin side-drawer${projectFormOpen ? ' is-open' : ''}`}
        id="project-form"
        aria-label={editingProject ? 'Edit project' : 'New project'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 6h7l2 2h7v11H4z" />
              <path d="M4 11h16M9 15h6" />
            </svg>
          </span>
          <h2 className="margin__title">
            {editingProject ? 'Edit project' : 'New project'}
          </h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close project form"
            onClick={() => setProjectFormOpen(false)}
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

        <form className="drawer-form" onSubmit={(event) => void onSubmitProject(event)}>
          <label className="drawer-form__label" htmlFor="project-name">
            Name
          </label>
          <input
            id="project-name"
            required
            value={projectForm.name}
            onChange={(event) => setProjectField('name', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="project-description">
            Description
          </label>
          <input
            id="project-description"
            value={projectForm.description}
            onChange={(event) => setProjectField('description', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="project-customer">
            Customer
          </label>
          <select
            id="project-customer"
            value={projectForm.customerId}
            onChange={(event) => setProjectField('customerId', event.target.value)}
          >
            <option value="">No customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="project-billing-item">
            Billing item
          </label>
          <select
            id="project-billing-item"
            value={projectForm.billingItemId}
            onChange={(event) => setProjectField('billingItemId', event.target.value)}
          >
            <option value="">Choose when billing time</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="project-default-rate">
            Default rate
          </label>
          <input
            id="project-default-rate"
            type="number"
            min="0"
            step="0.01"
            value={projectForm.defaultRate}
            onChange={(event) => setProjectField('defaultRate', event.target.value)}
          />
          <p className="drawer-form__hint">
            Used when a time entry leaves the rate blank.
          </p>

          <label className="drawer-form__check">
            <input
              type="checkbox"
              checked={projectForm.active}
              onChange={(event) => setProjectField('active', event.target.checked)}
            />
            Project is active
          </label>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              {editingProject ? 'Save project' : 'Create project'}
            </button>
            <span className="drawer-form__hint">
              Projects tag revenue, expenses, and time for profitability.
            </span>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${timeFormOpen ? ' is-open' : ''}`}
        id="time-entry-form"
        aria-label="Add time"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <h2 className="margin__title">Add time</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close time form"
            onClick={() => setTimeFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {timeError ? (
          <p className="members__error" role="alert">
            {timeError}
          </p>
        ) : null}

        <form className="drawer-form" onSubmit={(event) => void onSubmitTime(event)}>
          <label className="drawer-form__label" htmlFor="time-project">
            Project
          </label>
          <select
            id="time-project"
            value={timeForm.projectId}
            onChange={(event) => chooseTimeProject(event.target.value)}
          >
            <option value="">No project</option>
            {projectRows.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
                {project.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="time-date">
            Date
          </label>
          <input
            id="time-date"
            type="date"
            required
            value={timeForm.date}
            onChange={(event) => setTimeField('date', event.target.value)}
          />

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="time-hours">
                Hours
              </label>
              <input
                id="time-hours"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={timeForm.hours}
                onChange={(event) => setTimeField('hours', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="time-rate">
                Rate
              </label>
              <input
                id="time-rate"
                type="number"
                min="0"
                step="0.01"
                value={timeForm.rate}
                onChange={(event) => setTimeField('rate', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__check">
            <input
              type="checkbox"
              checked={timeForm.billable}
              onChange={(event) => setTimeField('billable', event.target.checked)}
            />
            Billable
          </label>

          <label className="drawer-form__label" htmlFor="time-notes">
            Notes
          </label>
          <input
            id="time-notes"
            value={timeForm.notes}
            onChange={(event) => setTimeField('notes', event.target.value)}
          />

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              Add time
            </button>
            <span className="drawer-form__hint">
              Hours × rate sets the billable value. Billable time can be rolled into an invoice.
            </span>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${rollupOpen ? ' is-open' : ''}`}
        id="rollup-form"
        aria-label="Bill time"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
              <path d="M14 3v6h6M8 13h8M8 17h5" />
            </svg>
          </span>
          <h2 className="margin__title">Bill time</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close bill time form"
            onClick={() => setRollupOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {rollupError ? (
          <p className="members__error" role="alert">
            {rollupError}
          </p>
        ) : null}

        <form className="drawer-form payment-form" onSubmit={(event) => void onSubmitRollup(event)}>
          <div className="payment-allocations">
            <div className="invoice-form__lines-head">
              <span className="drawer-form__label">Uninvoiced billable time</span>
              <span className="drawer-form__hint">{money(rollupTotal)} selected</span>
            </div>
            {uninvoicedEntries.length === 0 ? (
              <p className="report-note">No billable time left to invoice.</p>
            ) : (
              <table className="payment-allocations__table">
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col">Date</th>
                    <th scope="col">Member</th>
                    <th scope="col" className="num">
                      Hours
                    </th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {uninvoicedEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Bill time on ${entry.date}`}
                          checked={rollupEntryIds.includes(entry.id)}
                          onChange={() => toggleRollupEntry(entry.id)}
                        />
                      </td>
                      <td>{displayDate(entry.date)}</td>
                      <td>{entry.user.name}</td>
                      <td className="num">{hours(entry.hours)}</td>
                      <td className="num">{money(entry.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <label className="drawer-form__label" htmlFor="rollup-customer">
            Customer
          </label>
          <select
            id="rollup-customer"
            value={rollupForm.customerId}
            onChange={(event) => setRollupField('customerId', event.target.value)}
          >
            <option value="">Choose a customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="rollup-billing-item">
            Billing item
          </label>
          <select
            id="rollup-billing-item"
            value={rollupForm.billingItemId}
            onChange={(event) => setRollupField('billingItemId', event.target.value)}
          >
            <option value="">Use the project billing item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>

          <div className="drawer-form__pair">
            <div>
              <label className="drawer-form__label" htmlFor="rollup-issue-date">
                Issue date
              </label>
              <input
                id="rollup-issue-date"
                type="date"
                required
                value={rollupForm.issueDate}
                onChange={(event) => setRollupField('issueDate', event.target.value)}
              />
            </div>
            <div>
              <label className="drawer-form__label" htmlFor="rollup-due-date">
                Due date
              </label>
              <input
                id="rollup-due-date"
                type="date"
                required
                value={rollupForm.dueDate}
                onChange={(event) => setRollupField('dueDate', event.target.value)}
              />
            </div>
          </div>

          <label className="drawer-form__label" htmlFor="rollup-tax-rate">
            Tax rate (%)
          </label>
          <input
            id="rollup-tax-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={rollupForm.taxRate}
            onChange={(event) => setRollupField('taxRate', event.target.value)}
          />

          <label className="drawer-form__label" htmlFor="rollup-notes">
            Notes
          </label>
          <input
            id="rollup-notes"
            value={rollupForm.notes}
            onChange={(event) => setRollupField('notes', event.target.value)}
          />

          <div className="drawer-form__foot">
            <button
              className="btn btn--primary btn--sm"
              type="submit"
              disabled={busy || uninvoicedEntries.length === 0}
            >
              Draft invoice
            </button>
            <span className="drawer-form__hint">
              Creates a draft invoice; nothing posts to the ledger until it is sent.
            </span>
          </div>
        </form>
      </aside>

      <div
        className={`scrim${
          projectFormOpen || timeFormOpen || rollupOpen ? ' is-visible' : ''
        }`}
        aria-hidden="true"
        onClick={() => {
          setProjectFormOpen(false);
          setTimeFormOpen(false);
          setRollupOpen(false);
        }}
      />
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
