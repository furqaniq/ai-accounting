'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  REFRESH_TOKEN_KEY,
  SessionUser,
  TOKEN_KEY,
  clearSession,
  getAccessToken,
} from '@/lib/api';

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

export default function OverviewPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [spineOpen, setSpineOpen] = useState(false);
  const [marginOpen, setMarginOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [range, setRange] = useState<'30' | '90' | '365'>('30');
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [overdueReminders, setOverdueReminders] = useState(true);
  const [approvalNoteOpen, setApprovalNoteOpen] = useState(true);
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

  const scrimVisible = spineOpen || marginOpen;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSpineOpen(false);
        setMarginOpen(false);
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

  function onAskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toastLater('Clerk');
  }

  if (!user) {
    return (
      <main className="login-page">
        <p className="login-hint">Loading…</p>
      </main>
    );
  }

  const membership = user.memberships[0];
  const orgName = membership?.organizationName ?? '';
  const role = membership?.role ?? '';
  const roleLabel = role.charAt(0) + role.slice(1).toLowerCase();

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
                    onClick={() => {
                      setOrgMenuOpen(false);
                      if (m.organizationId !== membership?.organizationId) {
                        showToast('Organization switching arrives with tenant isolation.');
                      }
                    }}
                  >
                    {m.organizationName}
                    <span>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</span>
                  </button>
                ))}
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
            <a
              className="nav__item"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setSpineOpen(false);
                toastLater('Invoices');
              }}
            >
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                <path d="M14 3v6h6M8 13h8M8 17h5" />
              </svg>
              Invoices
            </a>
            <a
              className="nav__item"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setSpineOpen(false);
                toastLater('Banking');
              }}
            >
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
              </svg>
              Banking
            </a>
            <a
              className="nav__item"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                setSpineOpen(false);
                toastLater('Reports');
              }}
            >
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
              Reports
            </a>
            <a
              className="nav__item"
              href="#"
              id="nav-clerk-link"
              aria-label="Clerk, 2 pending approvals"
              onClick={(event) => {
                event.preventDefault();
                setSpineOpen(false);
                toastLater('Clerk');
              }}
            >
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Clerk
              <span className="nav__badge" id="nav-approval-count">
                2
              </span>
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
                id="clerk-toggle"
                type="button"
                aria-controls="margin"
                aria-expanded={marginOpen}
                onClick={() => setMarginOpen((open) => !open)}
              >
                <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                <span>Clerk</span>
                <span className="clerk-toggle__count" id="clerk-approval-count">
                  2
                </span>
              </button>
            </div>
          </header>

          <main className="page" id="main">
            <header className="page-head">
              <div>
                <h1>Overview</h1>
                <p className="page-head__meta">
                  {orgName} Fiscal year 2026. {todayLine()}.
                </p>
              </div>
              <div className="page-head__actions">
                <a
                  className="btn btn--outline"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    toastLater('Reconciliation');
                  }}
                >
                  Reconcile checking
                </a>
                <a
                  className="btn btn--primary"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    toastLater('New invoice');
                  }}
                >
                  New invoice
                </a>
              </div>
            </header>

            <section className="cash" aria-labelledby="cash-title">
              <div className="cash__head">
                <div>
                  <h2 className="cash__title" id="cash-title">
                    Cash across accounts
                  </h2>
                  <p className="cash__sub">Checking and savings, last 30 days</p>
                </div>
                <div className="cash__aside">
                  <div className="cash__figure">$84,290.16</div>
                  <div className="cash__delta">Up $6,210.00 this month</div>
                  <div className="range" aria-label="Chart range">
                    {(['30', '90', '365'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={range === value}
                        onClick={() => setRange(value)}
                      >
                        {value === '30' ? '30 days' : value === '90' ? '90 days' : 'Year'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="cash__chart">
                <svg
                  className="chart"
                  viewBox="0 0 760 240"
                  role="img"
                  aria-label="Cash balance rose from $78,080 on October 16 to $84,290 on November 13, with a dip around November 3."
                >
                  <line className="chart__grid" x1="20" y1="42.5" x2="740" y2="42.5" />
                  <line className="chart__grid" x1="20" y1="87.5" x2="740" y2="87.5" />
                  <line className="chart__grid" x1="20" y1="132.5" x2="740" y2="132.5" />
                  <line className="chart__grid" x1="20" y1="177.5" x2="740" y2="177.5" />

                  <path
                    className="chart__area"
                    d="M20,175.7 L45.7,170.3 L71.4,174.8 L97.1,154.1 L122.9,141.5 L148.6,149.6 L174.3,129.8 L200,121.7 L225.7,128.9 L251.4,135.2 L277.1,118.1 L302.9,105.5 L328.6,111.8 L354.3,99.2 L380,107.3 L405.7,115.4 L431.4,149.6 L457.1,135.2 L482.9,119.9 L508.6,109.1 L534.3,93.8 L560,83.4 L585.7,88.8 L611.4,73.1 L637.1,60.5 L662.9,67.7 L688.6,52.8 L714.3,42.3 L740,36 L740,200 L20,200 Z"
                  />

                  <path
                    className="chart__line"
                    pathLength="1"
                    d="M20,175.7 L45.7,170.3 L71.4,174.8 L97.1,154.1 L122.9,141.5 L148.6,149.6 L174.3,129.8 L200,121.7 L225.7,128.9 L251.4,135.2 L277.1,118.1 L302.9,105.5 L328.6,111.8 L354.3,99.2 L380,107.3 L405.7,115.4 L431.4,149.6 L457.1,135.2 L482.9,119.9 L508.6,109.1 L534.3,93.8 L560,83.4 L585.7,88.8 L611.4,73.1 L637.1,60.5 L662.9,67.7 L688.6,52.8 L714.3,42.3 L740,36"
                  />

                  <line className="chart__today" x1="740" y1="20" x2="740" y2="200" />
                  <circle className="chart__end" cx="740" cy="36" r="4.5" />
                  <circle className="chart__marker" cx="431.4" cy="149.6" r="3.5" />

                  <text x="740" y="26" textAnchor="end" className="chart__label">
                    $84,290
                  </text>
                  <text x="431" y="168" textAnchor="middle" className="chart__annotation">
                    Payroll, Nov 3
                  </text>
                  <text x="20" y="224" textAnchor="start">
                    Oct 16
                  </text>
                  <text x="380" y="224" textAnchor="middle">
                    Nov 1
                  </text>
                  <text x="740" y="224" textAnchor="end">
                    Nov 13
                  </text>
                </svg>
              </div>

              <div className="stats">
                <div className="stat">
                  <div className="stat__label">Income this month</div>
                  <div className="stat__value">$51,040.00</div>
                </div>
                <div className="stat">
                  <div className="stat__label">Expenses this month</div>
                  <div className="stat__value">$25,564.00</div>
                </div>
                <div className="stat">
                  <div className="stat__label">Net income</div>
                  <div className="stat__value is-positive">$19,356.00</div>
                </div>
              </div>
            </section>

            <section className="section" aria-labelledby="attention-title">
              <div className="section__head">
                <h2 className="section__title" id="attention-title">
                  Needs your attention
                </h2>
                <span className="section__meta">3 items</span>
              </div>
              <div className="attention">
                <div className="attention__item">
                  <span className="dot dot--red"></span>
                  <div>
                    <div className="attention__title">Invoice #1042 is 12 days overdue</div>
                    <div className="attention__meta">Northwind Supply</div>
                  </div>
                  <div className="attention__amount">$4,800.00</div>
                  <div className="attention__action">
                    <a
                      className="btn btn--ghost btn--sm"
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        toastLater('Invoices');
                      }}
                    >
                      Review invoice
                    </a>
                  </div>
                </div>
                <div className="attention__item">
                  <span className="dot dot--amber"></span>
                  <div>
                    <div className="attention__title">
                      Three transactions from your Nov 12 import need a category
                    </div>
                    <div className="attention__meta">Checking 2480</div>
                  </div>
                  <div className="attention__amount">+$1,260.00</div>
                  <div className="attention__action">
                    <a
                      className="btn btn--ghost btn--sm"
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        toastLater('Banking');
                      }}
                    >
                      Open banking
                    </a>
                  </div>
                </div>
                <div className="attention__item">
                  <span className="dot dot--amber"></span>
                  <div>
                    <div className="attention__title">Bill #2210 from Halden Paper is due Friday</div>
                    <div className="attention__meta">Halden Paper</div>
                  </div>
                  <div className="attention__amount">$2,843.00</div>
                  <div className="attention__action">
                    <a
                      className="btn btn--ghost btn--sm"
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        toastLater('Purchases');
                      }}
                    >
                      Review payment
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <section className="section" aria-labelledby="register-title">
              <div className="section__head">
                <h2 className="section__title" id="register-title">
                  Checking 2480, recent activity
                </h2>
                <a
                  className="link"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    toastLater('Banking');
                  }}
                >
                  Open banking
                </a>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">
                    Recent activity in checking account 2480 with running balance
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Description</th>
                      <th scope="col">Account</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col" className="num balance">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Nov 12</td>
                      <td>ACME WIRE 4471</td>
                      <td>Invoice #1038 payment</td>
                      <td className="num">+$1,000.00</td>
                      <td className="num balance">$65,890.16</td>
                    </tr>
                    <tr>
                      <td>Nov 12</td>
                      <td>CHECK 2041</td>
                      <td>Invoice #1041 payment</td>
                      <td className="num">+$160.00</td>
                      <td className="num balance">$64,890.16</td>
                    </tr>
                    <tr>
                      <td>Nov 11</td>
                      <td>CARD CREDIT</td>
                      <td>Halden Paper refund</td>
                      <td className="num">+$100.00</td>
                      <td className="num balance">$64,730.16</td>
                    </tr>
                    <tr>
                      <td>Nov 10</td>
                      <td>BANK FEE</td>
                      <td>Bank fees</td>
                      <td className="num">−$18.00</td>
                      <td className="num balance">$64,630.16</td>
                    </tr>
                    <tr>
                      <td>Nov 9</td>
                      <td>PAYROLL NOV</td>
                      <td>Payroll expense</td>
                      <td className="num">−$8,400.00</td>
                      <td className="num balance">$64,648.16</td>
                    </tr>
                    <tr>
                      <td>Nov 8</td>
                      <td>RENT NOV</td>
                      <td>Rent expense</td>
                      <td className="num">−$4,200.00</td>
                      <td className="num balance">$73,048.16</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </main>
        </div>

        <aside className={`margin${marginOpen ? ' is-open' : ''}`} id="margin" aria-label="Clerk">
          <div className="margin__head">
            <span className="msg__icon" aria-hidden="true">
              <svg className="icon icon--sm" viewBox="0 0 24 24">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            <h2 className="margin__title">Clerk</h2>
            <span className="margin__status">
              <span className="dot dot--green"></span>Ready
            </span>
            <button
              className="icon-btn margin__close"
              id="close-margin"
              type="button"
              aria-label="Close clerk"
              onClick={() => setMarginOpen(false)}
            >
              <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {approvalNoteOpen ? (
            <div className="margin-note">
              <div className="margin-note__kicker">
                <span className="dot dot--red"></span>Needs your approval
              </div>
              <p className="margin-note__body">
                Northwind Supply is <strong>12 days overdue</strong>. I drafted a reminder that
                links to invoice #1042.
              </p>
              <div className="margin-note__actions">
                <a
                  className="btn btn--primary btn--sm"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    toastLater('Approvals');
                  }}
                >
                  Review draft
                </a>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => {
                    setApprovalNoteOpen(false);
                    showToast('Dismissed for now.');
                  }}
                >
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          <div className="margin-note">
            <div className="margin-note__kicker margin-note__kicker--quiet">Scheduled</div>
            <div className="mini-list">
              <div className="mini-row">
                <div>
                  <div className="mini-row__title">Weekly cash flow summary</div>
                  <div className="mini-row__meta">Mondays at 9:00</div>
                </div>
                <button
                  className="switch"
                  type="button"
                  role="switch"
                  aria-checked={weeklySummary}
                  aria-label="Pause weekly cash flow summary"
                  onClick={() => {
                    const next = !weeklySummary;
                    setWeeklySummary(next);
                    showToast(
                      next
                        ? 'Weekly cash flow summary resumed.'
                        : 'Weekly cash flow summary paused.',
                    );
                  }}
                ></button>
              </div>
              <div className="mini-row">
                <div>
                  <div className="mini-row__title">Overdue reminders</div>
                  <div className="mini-row__meta">When an invoice is 7 days late</div>
                </div>
                <button
                  className="switch"
                  type="button"
                  role="switch"
                  aria-checked={overdueReminders}
                  aria-label="Pause overdue reminders"
                  onClick={() => {
                    const next = !overdueReminders;
                    setOverdueReminders(next);
                    showToast(next ? 'Overdue reminders resumed.' : 'Overdue reminders paused.');
                  }}
                ></button>
              </div>
            </div>
            <div className="margin__foot">
              <a
                className="link"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  toastLater('Automations');
                }}
              >
                Manage automations
              </a>
            </div>
          </div>

          <div className="margin-note">
            <div className="margin-note__kicker margin-note__kicker--quiet">Ask the clerk</div>
            <form className="ask" id="ask-clerk-form" onSubmit={onAskSubmit}>
              <label className="sr-only" htmlFor="ask-clerk-input">
                Ask the clerk about your books
              </label>
              <div className="ask__row">
                <input
                  id="ask-clerk-input"
                  name="ask"
                  type="text"
                  placeholder="Ask about your books"
                  autoComplete="off"
                />
                <button className="btn btn--primary btn--sm" type="submit">
                  Ask
                </button>
              </div>
            </form>
          </div>

          <div className="margin__foot">
            <a
              className="link"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                toastLater('Agent activity');
              }}
            >
              View activity
            </a>
          </div>
        </aside>
      </div>

      <div
        className={`scrim${scrimVisible ? ' is-visible' : ''}`}
        id="scrim"
        aria-hidden="true"
        onClick={() => {
          setSpineOpen(false);
          setMarginOpen(false);
        }}
      ></div>
      <div className={`toast${toast ? ' is-visible' : ''}`} id="toast" role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
