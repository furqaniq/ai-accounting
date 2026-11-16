'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuditLogDrawer from '@/components/audit-log-drawer';
import OrgSettingsDrawer from '@/components/org-settings-drawer';
import {
  API_URL,
  ActiveOrganization,
  REFRESH_TOKEN_KEY,
  SessionUser,
  Member,
  ROLES,
  canManageMembers,
  clearSession,
  createMember,
  fetchActiveOrganization,
  fetchDashboard,
  fetchMembers,
  getAccessToken,
  getActiveOrgId,
  removeMember,
  setActiveOrgId,
  updateMemberRole,
} from '@/lib/api';
import type { DashboardActivity, DashboardReport } from '@/lib/api';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function todayLine(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  const amount = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${amount}` : `$${amount}`;
}

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function longDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const ACTIVITY_LABELS: Record<DashboardActivity['type'], string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  expense: 'Expense',
  payment: 'Payment',
  'bill-payment': 'Bill payment',
};

function TrendBars({ buckets }: { buckets: DashboardReport['trend']['buckets'] }) {
  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.income, bucket.expenses]));
  const width = 720;
  const height = 220;
  const top = 14;
  const bottom = 42;
  const plotHeight = height - top - bottom;
  const groupWidth = buckets.length > 0 ? (width - 24) / buckets.length : width;
  const barWidth = Math.min(18, groupWidth * 0.26);
  const baseline = top + plotHeight;

  return (
    <svg
      className="chart trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Monthly income and expense trend"
    >
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <line
          key={ratio}
          className="chart__grid"
          x1="12"
          x2={width - 12}
          y1={baseline - plotHeight * ratio}
          y2={baseline - plotHeight * ratio}
        />
      ))}
      <line className="chart__today" x1="12" x2={width - 12} y1={baseline} y2={baseline} />
      {buckets.map((bucket, index) => {
        const center = 12 + groupWidth * index + groupWidth / 2;
        const incomeHeight = (bucket.income / max) * plotHeight;
        const expenseHeight = (bucket.expenses / max) * plotHeight;
        return (
          <g key={bucket.month}>
            <rect
              x={center - barWidth - 2}
              y={baseline - incomeHeight}
              width={barWidth}
              height={Math.max(incomeHeight, bucket.income > 0 ? 2 : 0)}
              fill="var(--ledger)"
              rx="1"
            >
              <title>
                {bucket.label}: {money(bucket.income)} income
              </title>
            </rect>
            <rect
              x={center + 2}
              y={baseline - expenseHeight}
              width={barWidth}
              height={Math.max(expenseHeight, bucket.expenses > 0 ? 2 : 0)}
              fill="var(--red-ink)"
              rx="1"
            >
              <title>
                {bucket.label}: {money(bucket.expenses)} expenses
              </title>
            </rect>
            <text x={center} y={height - 18} textAnchor="middle">
              {bucket.label.split(' ')[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function OverviewPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [spineOpen, setSpineOpen] = useState(false);
  const [marginOpen, setMarginOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersBusy, setMembersBusy] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState('STAFF');
  const [membersError, setMembersError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [activeOrg, setActiveOrg] = useState<ActiveOrganization | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const initialTo = isoToday();
  const [trendFrom, setTrendFrom] = useState(`${initialTo.slice(0, 4)}-01-01`);
  const [trendTo, setTrendTo] = useState(initialTo);
  const [dashboard, setDashboard] = useState<DashboardReport | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error('unauthorized');
        return res.json();
      })
      .then((data: SessionUser) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
          router.replace('/login');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const stored = getActiveOrgId();
    const initial =
      user.memberships.find((m) => m.organizationId === stored)?.organizationId ??
      user.memberships[0]?.organizationId;
    if (!initial) return;

    let cancelled = false;
    (async () => {
      const [org, members] = await Promise.all([
        fetchActiveOrganization(initial),
        fetchMembers(initial),
      ]);
      if (cancelled) return;
      setActiveOrg(org);
      setMemberCount(members.length);
      setActiveOrgId(org.organizationId);
    })().catch(() => {
      if (cancelled) return;
      setActiveOrgId(null);
      setActiveOrg(null);
      setMemberCount(null);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!activeOrg || !trendFrom || !trendTo) return;
    let cancelled = false;
    setDashboardLoading(true);
    fetchDashboard(activeOrg.organizationId, { from: trendFrom, to: trendTo })
      .then((report) => {
        if (cancelled) return;
        setDashboard(report);
        setDashboardError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setDashboard(null);
        setDashboardError(error instanceof Error ? error.message : 'The dashboard is not available');
      })
      .finally(() => {
        if (!cancelled) setDashboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrg, trendFrom, trendTo]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    if (from) setTrendFrom(from);
    if (to) setTrendTo(to);
  }, []);

  const switchOrg = useCallback(
    async (organizationId: string) => {
      setOrgMenuOpen(false);
      if (organizationId === activeOrg?.organizationId) return;
      try {
        const [org, members] = await Promise.all([
          fetchActiveOrganization(organizationId),
          fetchMembers(organizationId),
        ]);
        setActiveOrg(org);
        setMemberCount(members.length);
        setActiveOrgId(org.organizationId);
        showToast(`Switched to ${org.organizationName}`);
      } catch {
        showToast('That organization is not available to you.');
      }
    },
    [activeOrg?.organizationId, showToast],
  );

  const roleCanManage = canManageMembers(activeOrg?.role ?? '');

  const loadMembers = useCallback(async () => {
    if (!activeOrg) return;
    try {
      setMembers(await fetchMembers(activeOrg.organizationId));
    } catch {
      setMembersError('Members are not available right now.');
    }
  }, [activeOrg]);

  const openMembers = useCallback(() => {
    setOrgMenuOpen(false);
    setMembersOpen(true);
    setMembersError(null);
    void loadMembers();
  }, [loadMembers]);

  async function onAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrg || membersBusy) return;
    setMembersBusy(true);
    setMembersError(null);
    try {
      await createMember(activeOrg.organizationId, memberEmail.trim(), memberRole);
      setMemberEmail('');
      setMemberRole('STAFF');
      await loadMembers();
      showToast('Member added to the book.');
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : 'Could not add that member');
    } finally {
      setMembersBusy(false);
    }
  }

  async function onChangeRole(member: Member, role: string) {
    if (!activeOrg || role === member.role || membersBusy) return;
    setMembersBusy(true);
    setMembersError(null);
    try {
      await updateMemberRole(activeOrg.organizationId, member.id, role);
      await loadMembers();
      showToast(`${member.name} is now ${role.charAt(0) + role.slice(1).toLowerCase()}.`);
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : 'Could not change that role');
    } finally {
      setMembersBusy(false);
    }
  }

  async function onRemoveMember(member: Member) {
    if (!activeOrg || membersBusy) return;
    setMembersBusy(true);
    setMembersError(null);
    try {
      await removeMember(activeOrg.organizationId, member.id);
      await loadMembers();
      setMemberCount((count) => (count === null ? count : Math.max(1, count - 1)));
      showToast(`${member.name} was removed from the book.`);
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : 'Could not remove that member');
    } finally {
      setMembersBusy(false);
    }
  }

  const onSettingsSaved = useCallback((settings: { name: string }) => {
    setActiveOrg((current) =>
      current ? { ...current, organizationName: settings.name } : current,
    );
    setUser((current) =>
      current
        ? {
            ...current,
            memberships: current.memberships.map((m) =>
              m.organizationId === activeOrg?.organizationId
                ? { ...m, organizationName: settings.name }
                : m,
            ),
          }
        : current,
    );
  }, [activeOrg?.organizationId]);

  const openSettings = useCallback(() => {
    setOrgMenuOpen(false);
    setSettingsOpen(true);
  }, []);

  const openAudit = useCallback(() => {
    setOrgMenuOpen(false);
    setAuditOpen(true);
  }, []);

  const scrimVisible = spineOpen || marginOpen || membersOpen || settingsOpen || auditOpen;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSpineOpen(false);
        setMarginOpen(false);
        setMembersOpen(false);
        setSettingsOpen(false);
        setAuditOpen(false);
        setOrgMenuOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function toastLater(what: string) {
    showToast(`${what} arrives with its own slice.`);
  }

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toastLater('Search');
  }

  if (!user) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Loading…</p>
      </main>
    );
  }

  const membership = user.memberships[0];
  const orgName = activeOrg?.organizationName ?? membership?.organizationName ?? '';
  const role = activeOrg?.role ?? membership?.role ?? '';
  const roleLabel = role.charAt(0) + role.slice(1).toLowerCase();

  const cashChange = dashboard
    ? dashboard.cash.accounts.reduce((sum, account) => sum + account.netChange, 0)
    : 0;
  const trendActive = (days: number) => trendFrom === shiftDate(trendTo, -(days - 1));
  const attentionCount = dashboard
    ? dashboard.attention.overdueInvoices +
      dashboard.attention.overdueBills +
      dashboard.attention.unmatchedBankTransactions
    : 0;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="app-shell">
        <aside className={`spine${spineOpen ? ' is-open' : ''}`} id="spine">
          <a className="brand" href="/">
            <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect className="mark-paper" x="4.5" y="3" width="23" height="26" rx="1" />
              <path className="mark-rule" d="M9 9h14M9 14h14M9 19h9" />
              <path className="mark-margin" d="M12 3v26" />
            </svg>
            <span>
              <span className="brand__name">Daybook</span>
              <span className="brand__sub">AI accounting</span>
            </span>
          </a>

          <div className="org">
            <button
              className="org__button"
              id="org-button"
              type="button"
              aria-expanded={orgMenuOpen}
              aria-controls="org-menu"
              onClick={() => setOrgMenuOpen((open) => !open)}
            >
              <span>
                <span className="org__name">{orgName}</span>
                <span className="org__meta">{roleLabel}</span>
              </span>
              <svg className="icon icon--sm org__chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {orgMenuOpen ? (
              <div className="org__menu" id="org-menu">
                {user.memberships.map((m) => (
                  <button
                    key={m.organizationId}
                    className="org__option"
                    type="button"
                    aria-current={
                      m.organizationId === activeOrg?.organizationId ? 'true' : undefined
                    }
                    onClick={() => void switchOrg(m.organizationId)}
                  >
                    {m.organizationName}
                    <span>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</span>
                  </button>
                ))}
                <button className="org__members" type="button" onClick={openMembers}>
                  Members
                  {memberCount !== null ? (
                    <span>
                      {memberCount} {memberCount === 1 ? 'member' : 'members'}
                    </span>
                  ) : null}
                </button>
                {role === 'OWNER' || role === 'ADMIN' ? (
                  <>
                    <button className="org__members" type="button" onClick={openSettings}>
                      Settings
                      <span>Fiscal, tax, currency</span>
                    </button>
                    <button className="org__members" type="button" onClick={openAudit}>
                      Audit log
                      <span>Every change</span>
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <nav className="nav" aria-label="Primary">
            <a className="nav__item is-active" href="/" aria-current="page">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Overview
            </a>
            <a className="nav__item" href="/accounts">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M4 9h16M4 14h16M9 9v11" />
              </svg>
              Accounts
            </a>
            <a className="nav__item" href="/ledger">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v16H4z" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
              Journal
            </a>
            <a className="nav__item" href="/customers">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
                <path d="M16 6.5a3 3 0 0 1 0 5.4M18.5 18.8c-.3-2.1-1.3-3.5-2.9-4.2" />
              </svg>
              Customers
            </a>
            <a className="nav__item" href="/items">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
                <path d="M4 7.5 12 12l8-4.5M12 12v9" />
              </svg>
              Items
            </a>
            <a className="nav__item" href="/estimates">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                <path d="M15 3v4h4M9 12h6M9 16h4" />
                <path d="m8 8 1 1 2-2" />
              </svg>
              Estimates
            </a>
            <a className="nav__item" href="/invoices">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                <path d="M14 3v6h6M8 13h8M8 17h5" />
              </svg>
              Invoices
            </a>
            <a className="nav__item" href="/payments">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7h18v10H3z" />
                <path d="M3 10h18" />
                <circle cx="17" cy="14" r="1.2" />
              </svg>
              Payments
            </a>
            <a className="nav__item" href="/vendors">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 21V7l8-4 8 4v14" />
                <path d="M9 21v-6h6v6M8 10h2M14 10h2" />
              </svg>
              Vendors
            </a>
            <a className="nav__item" href="/bills">
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z" />
                <path d="M9 8h6M9 12h6M9 16h3" />
              </svg>
              Bills
            </a>
            <a className="nav__item" href="/bill-payments" onClick={() => setSpineOpen(false)}>
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7h18v10H3z" />
                <path d="M3 10h18" />
                <path d="m16 15 2-2-2-2" />
              </svg>
              Bill payments
            </a>
            <a className="nav__item" href="/expenses" onClick={() => setSpineOpen(false)}>
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7h18v10H3z" />
                <path d="M3 10h18" />
                <path d="M7 14h4" />
              </svg>
              Expenses
            </a>
            <a className="nav__item" href="/banking" onClick={() => setSpineOpen(false)}>
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
              </svg>
              Banking
            </a>
            <a className="nav__item" href="/reconcile" onClick={() => setSpineOpen(false)}>
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h10M4 17h7" />
                <path d="m15 15 2 2 4-4" />
              </svg>
              Reconcile
            </a>
            <a className="nav__item" href="/reports" onClick={() => setSpineOpen(false)}>
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
              Reports
            </a>
          </nav>

          <div className="spine__foot">
            <div className="user">
              <div className="avatar" aria-hidden="true">
                {initials(user.name)}
              </div>
              <div>
                <div className="user__name">{user.name}</div>
                <div className="user__role">{roleLabel}</div>
              </div>
              <div className="user__actions">
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Account settings"
                  onClick={() => showToast('Settings arrive with the settings slice.')}
                >
                  <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.7 2.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7 7 4.3l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="spine__foot-actions">
              <button className="spine-signout" type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <button
              className="icon-btn menu-toggle"
              id="menu-toggle"
              type="button"
              aria-label="Open navigation"
              aria-expanded={spineOpen}
              aria-controls="spine"
              onClick={() => setSpineOpen((open) => !open)}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <form className="search" role="search" onSubmit={onSearchSubmit}>
              <span className="search__icon">
                <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
              </span>
              <label className="sr-only" htmlFor="global-search">
                Search
              </label>
              <input
                id="global-search"
                type="search"
                placeholder="Search invoices, bills, contacts"
                autoComplete="off"
              />
            </form>

            <div className="topbar__right">
              <button
                className="btn btn--outline btn--sm clerk-toggle"
                id="period-toggle"
                type="button"
                aria-controls="margin"
                aria-expanded={marginOpen}
                onClick={() => setMarginOpen((open) => !open)}
              >
                <span>Period</span>
              </button>
            </div>
          </header>

          <main className="page" id="main">
            <header className="page-head">
              <div>
                <h1>Overview</h1>
                <p className="page-head__meta">
                  {orgName} ·{' '}
                  {dashboard
                    ? `${longDate(dashboard.from)} – ${longDate(dashboard.to)}`
                    : 'Reading the ledger'}{' '}
                  · {todayLine()}.
                </p>
              </div>
              <div className="page-head__actions">
                <a className="btn btn--outline" href="/reconcile">
                  Reconcile checking
                </a>
                <a className="btn btn--primary" href="/invoices">
                  New invoice
                </a>
              </div>
            </header>

            {dashboardError ? (
              <p className="members__error" role="alert">
                {dashboardError}
              </p>
            ) : null}

            <section className="cash" aria-labelledby="cash-title">
              <div className="cash__head">
                <div>
                  <h2 className="cash__title" id="cash-title">
                    Cash across accounts
                  </h2>
                  <p className="cash__sub">
                    {dashboard
                      ? `As of ${longDate(dashboard.to)} · ${dashboard.cash.accounts.length} ${
                          dashboard.cash.accounts.length === 1 ? 'account' : 'accounts'
                        }`
                      : 'Reading balances'}
                  </p>
                </div>
                <div className="cash__aside">
                  <a
                    className="cash__figure"
                    href={`/reports?tab=cash-flow&from=${trendFrom}&to=${trendTo}`}
                  >
                    {dashboard ? money(dashboard.cash.total) : '—'}
                  </a>
                  <div
                    className={`cash__delta${cashChange < 0 ? ' is-negative' : ''}`}
                    aria-live="polite"
                  >
                    {!dashboard
                      ? '…'
                      : cashChange === 0
                        ? 'No movement in this period'
                        : `${cashChange > 0 ? 'Up' : 'Down'} ${money(
                            Math.abs(cashChange),
                          )} this period`}
                  </div>
                </div>
              </div>

              <div className="cash__chart">
                {dashboard && dashboard.cash.accounts.length > 0 ? (
                  <table className="data-table dashboard-cash-table">
                    <caption className="sr-only">
                      Cash balances by ledger account as of the selected date
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Ledger</th>
                        <th scope="col" className="num">
                          Balance
                        </th>
                        <th scope="col" className="num">
                          Change in period
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.cash.accounts.map((account) => (
                        <tr key={account.id}>
                          <td>
                            <a
                              className="invoice-link"
                              href={`/ledger?account=${account.id}&from=${trendFrom}&to=${trendTo}`}
                            >
                              {account.name}
                            </a>
                          </td>
                          <td className="muted">{account.code}</td>
                          <td className="num">{money(account.balance)}</td>
                          <td className={`num${account.netChange < 0 ? ' is-negative' : ''}`}>
                            {money(account.netChange)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="empty">
                    {dashboard ? 'No cash accounts are linked yet.' : 'Reading balances…'}
                  </p>
                )}
              </div>

              <div className="stats">
                <div className="stat">
                  <div className="stat__label">
                    <a className="link" href="/reports/ar-aging">
                      Receivables
                    </a>
                  </div>
                  <div className="stat__value">
                    {dashboard ? money(dashboard.receivables.total) : '—'}
                  </div>
                  <div className="stat__meta">
                    {dashboard
                      ? `${money(dashboard.receivables.overdue)} overdue · ${
                          dashboard.receivables.openCount
                        } open`
                      : '—'}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat__label">
                    <a className="link" href="/reports/ap-aging">
                      Payables
                    </a>
                  </div>
                  <div className="stat__value">
                    {dashboard ? money(dashboard.payables.total) : '—'}
                  </div>
                  <div className="stat__meta">
                    {dashboard
                      ? `${money(dashboard.payables.overdue)} overdue · ${
                          dashboard.payables.openCount
                        } open`
                      : '—'}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat__label">
                    <a
                      className="link"
                      href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}
                    >
                      Net income
                    </a>
                  </div>
                  <div
                    className={`stat__value${
                      dashboard && dashboard.trend.netIncome < 0
                        ? ' is-negative'
                        : dashboard
                          ? ' is-positive'
                          : ''
                    }`}
                  >
                    {dashboard ? money(dashboard.trend.netIncome) : '—'}
                  </div>
                  <div className="stat__meta">
                    {dashboard
                      ? `${money(dashboard.trend.totalIncome)} income − ${money(
                          dashboard.trend.totalExpenses,
                        )} expenses`
                      : '—'}
                  </div>
                </div>
              </div>
            </section>

            <section className="section" aria-labelledby="trend-title">
              <div className="section__head">
                <div>
                  <h2 className="section__title" id="trend-title">
                    Income vs expenses
                  </h2>
                  <p className="section__meta">
                    {dashboard
                      ? `${longDate(dashboard.from)} – ${longDate(dashboard.to)}`
                      : 'Reading the ledger'}
                  </p>
                </div>
                <a
                  className="link"
                  href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}
                >
                  Open profit &amp; loss
                </a>
              </div>
              <div className="statement-controls dashboard-controls">
                <label>
                  From
                  <input
                    type="date"
                    aria-label="From date"
                    value={trendFrom}
                    onChange={(event) => setTrendFrom(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    aria-label="To date"
                    value={trendTo}
                    onChange={(event) => setTrendTo(event.target.value)}
                  />
                </label>
                <div className="range" aria-label="Trend range">
                  {[30, 90, 365].map((days) => (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={trendActive(days)}
                      onClick={() => setTrendFrom(shiftDate(trendTo, -(days - 1)))}
                    >
                      {days === 30 ? '30 days' : days === 90 ? '90 days' : 'Year'}
                    </button>
                  ))}
                </div>
              </div>
              {dashboard && dashboard.trend.buckets.some((bucket) => bucket.income > 0 || bucket.expenses > 0) ? (
                <div className="cash__chart trend-shell">
                  <div className="trend-legend">
                    <span>
                      <i className="trend-swatch trend-swatch--income" /> Income
                    </span>
                    <span>
                      <i className="trend-swatch trend-swatch--expense" /> Expenses
                    </span>
                  </div>
                  <TrendBars buckets={dashboard.trend.buckets} />
                </div>
              ) : (
                <p className="empty">
                  {dashboardLoading ? 'Reading the ledger…' : 'No income or expense posted in this period.'}
                </p>
              )}
            </section>

            <section className="section" aria-labelledby="recent-title">
              <div className="section__head">
                <h2 className="section__title" id="recent-title">
                  Recent activity
                </h2>
                <span className="section__meta">
                  {dashboard ? `${longDate(dashboard.from)} – ${longDate(dashboard.to)}` : ''}
                </span>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">
                    Recent invoices, bills, expenses, and payments in the selected period
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Document</th>
                      <th scope="col">Party</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard && dashboard.recentActivity.length > 0 ? (
                      dashboard.recentActivity.map((row) => (
                        <tr key={`${row.type}-${row.id}`}>
                          <td>{shortDate(row.date)}</td>
                          <td>
                            <a className="invoice-link" href={row.href}>
                              {row.number}
                            </a>
                          </td>
                          <td>{row.party ?? '—'}</td>
                          <td>
                            <span className="activity-type">{ACTIVITY_LABELS[row.type]}</span>
                            <span className="muted"> · {row.status}</span>
                          </td>
                          <td className="num">{money(row.amount)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="accounts-empty">
                          {dashboardLoading
                            ? 'Reading the ledger…'
                            : 'No activity in this period.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </main>
        </div>

        <aside className={`margin${marginOpen ? ' is-open' : ''}`} id="margin" aria-label="Period summary">
          <div className="margin__head">
            <h2 className="margin__title">Period</h2>
            <span className="margin__status">
              {dashboard ? `${shortDate(dashboard.from)} – ${shortDate(dashboard.to)}` : ''}
            </span>
            <button
              className="icon-btn margin__close"
              id="close-margin"
              type="button"
              aria-label="Close period summary"
              onClick={() => setMarginOpen(false)}
            >
              <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="margin-note">
            <div className={`margin-note__kicker${attentionCount === 0 ? ' margin-note__kicker--quiet' : ''}`}>
              {attentionCount > 0 ? (
                <>
                  <span className="dot dot--red"></span>Needs attention
                </>
              ) : (
                'All clear'
              )}
            </div>
            {dashboard && attentionCount > 0 ? (
              <div className="mini-list">
                {dashboard.attention.overdueInvoices > 0 ? (
                  <a className="mini-row" href="/reports/ar-aging">
                    <span>
                      <span className="mini-row__title">Overdue invoices</span>
                      <span className="mini-row__meta">Open receivables past due</span>
                    </span>
                    <span className="mini-row__count">
                      {dashboard.attention.overdueInvoices}
                    </span>
                  </a>
                ) : null}
                {dashboard.attention.overdueBills > 0 ? (
                  <a className="mini-row" href="/reports/ap-aging">
                    <span>
                      <span className="mini-row__title">Overdue bills</span>
                      <span className="mini-row__meta">Open payables past due</span>
                    </span>
                    <span className="mini-row__count">{dashboard.attention.overdueBills}</span>
                  </a>
                ) : null}
                {dashboard.attention.unmatchedBankTransactions > 0 ? (
                  <a className="mini-row" href="/banking">
                    <span>
                      <span className="mini-row__title">Unmatched bank activity</span>
                      <span className="mini-row__meta">Imported transactions to resolve</span>
                    </span>
                    <span className="mini-row__count">
                      {dashboard.attention.unmatchedBankTransactions}
                    </span>
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="margin-note__body">
                {dashboard ? 'All clear for this period.' : 'Reading the ledger…'}
              </p>
            )}
          </div>

          <div className="margin-note">
            <div className="margin-note__kicker margin-note__kicker--quiet">This period</div>
            <div className="mini-list">
              <a
                className="mini-row"
                href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}
              >
                <span className="mini-row__title">Income</span>
                <span className="mini-row__amount">
                  {dashboard ? money(dashboard.trend.totalIncome) : '—'}
                </span>
              </a>
              <a
                className="mini-row"
                href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}
              >
                <span className="mini-row__title">Expenses</span>
                <span className="mini-row__amount">
                  {dashboard ? money(dashboard.trend.totalExpenses) : '—'}
                </span>
              </a>
              <a
                className="mini-row"
                href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}
              >
                <span className="mini-row__title">Net income</span>
                <span className="mini-row__amount">
                  {dashboard ? money(dashboard.trend.netIncome) : '—'}
                </span>
              </a>
            </div>
          </div>

          <div className="margin-note">
            <div className="margin-note__kicker margin-note__kicker--quiet">Jump to</div>
            <div className="mini-list">
              <a className="mini-row" href={`/reports?tab=profit-loss&from=${trendFrom}&to=${trendTo}`}>
                <span className="mini-row__title">Profit &amp; loss</span>
                <span className="mini-row__meta">Statement</span>
              </a>
              <a className="mini-row" href="/reports/ar-aging">
                <span className="mini-row__title">AR aging</span>
                <span className="mini-row__meta">Receivables</span>
              </a>
              <a className="mini-row" href="/reports/ap-aging">
                <span className="mini-row__title">AP aging</span>
                <span className="mini-row__meta">Payables</span>
              </a>
              <a className="mini-row" href="/banking">
                <span className="mini-row__title">Banking</span>
                <span className="mini-row__meta">Activity and matching</span>
              </a>
            </div>
          </div>
        </aside>
      </div>

      <aside
        className={`margin side-drawer${membersOpen ? ' is-open' : ''}`}
        id="members"
        aria-label="Members"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 20c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />
              <path d="M16 5.4a3 3 0 0 1 0 5.6M17.5 14.8c2 .6 3.2 2.4 3.6 5.2" />
            </svg>
          </span>
          <h2 className="margin__title">Members</h2>
          <span className="margin__status">
            {members ? `${members.length} in ${activeOrg?.organizationName ?? 'this book'}` : ''}
          </span>
          <button
            className="icon-btn margin__close"
            id="close-members"
            type="button"
            aria-label="Close members"
            onClick={() => setMembersOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {membersError ? (
          <p className="members__error" role="alert">
            {membersError}
          </p>
        ) : null}

        {!roleCanManage ? (
          <p className="members__note">
            You can see who keeps this book. Only owners and admins can change roles or invite
            people.
          </p>
        ) : null}

        <div className="members__list">
          {members === null ? (
            <p className="members__empty">Opening the register…</p>
          ) : (
            members.map((member) => (
              <div className="member-row" key={member.id}>
                <span className="avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="member-row__who">
                  <span className="member-row__name">{member.name}</span>
                  <span className="member-row__email">{member.email}</span>
                </span>
                {roleCanManage ? (
                  <span className="member-row__controls">
                    <label className="sr-only" htmlFor={`role-${member.id}`}>
                      Role for {member.name}
                    </label>
                    <select
                      id={`role-${member.id}`}
                      className="member-row__role"
                      value={member.role}
                      disabled={membersBusy}
                      onChange={(event) => void onChangeRole(member, event.target.value)}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role.charAt(0) + role.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn member-row__remove"
                      type="button"
                      aria-label={`Remove ${member.name}`}
                      disabled={membersBusy}
                      onClick={() => void onRemoveMember(member)}
                    >
                      <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13M10 11v5.5M14 11v5.5" />
                      </svg>
                    </button>
                  </span>
                ) : (
                  <span className="member-row__role-static">
                    {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {roleCanManage ? (
          <form className="members__add" onSubmit={(event) => void onAddMember(event)}>
            <div className="margin-note__kicker margin-note__kicker--quiet">Add to the book</div>
            <label className="sr-only" htmlFor="member-email">
              Member email
            </label>
            <input
              id="member-email"
              name="email"
              type="email"
              required
              placeholder="name@company.test"
              autoComplete="off"
              value={memberEmail}
              onChange={(event) => setMemberEmail(event.target.value)}
            />
            <div className="members__add-row">
              <label className="sr-only" htmlFor="member-role">
                Role
              </label>
              <select
                id="member-role"
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value)}
              >
                {ROLES.filter((role) => role !== 'OWNER').map((role) => (
                  <option key={role} value={role}>
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <button className="btn btn--primary btn--sm" type="submit" disabled={membersBusy}>
                Add member
              </button>
            </div>
          </form>
        ) : null}
      </aside>

      <OrgSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        activeOrg={activeOrg}
        canManage={roleCanManage}
        onSaved={onSettingsSaved}
        onToast={showToast}
      />

      <AuditLogDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        activeOrg={activeOrg}
      />

      <div
        className={`scrim${scrimVisible ? ' is-visible' : ''}`}
        id="scrim"
        aria-hidden="true"
        onClick={() => {
          setSpineOpen(false);
          setMarginOpen(false);
          setMembersOpen(false);
          setSettingsOpen(false);
          setAuditOpen(false);
        }}
      ></div>
      <div className={`toast${toast ? ' is-visible' : ''}`} id="toast" role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
