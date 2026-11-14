'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ActiveOrganization, clearSession } from '@/lib/api';

export type SpineSection =
  | 'accounts'
  | 'ledger'
  | 'customers'
  | 'items'
  | 'estimates'
  | 'invoices'
  | 'payments';

interface NavItem {
  href: string;
  label: string;
  section?: SpineSection;
  icon: ReactNode;
  comingSoon?: boolean;
}

const NAV: NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
  },
  {
    href: '/accounts',
    label: 'Accounts',
    section: 'accounts',
    icon: (
      <>
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h16M4 14h16M9 9v11" />
      </>
    ),
  },
  {
    href: '/ledger',
    label: 'Journal',
    section: 'ledger',
    icon: (
      <>
        <path d="M4 4h16v16H4z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
  },
  {
    href: '/customers',
    label: 'Customers',
    section: 'customers',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
        <path d="M16 6.5a3 3 0 0 1 0 5.4M18.5 18.8c-.3-2.1-1.3-3.5-2.9-4.2" />
      </>
    ),
  },
  {
    href: '/items',
    label: 'Items',
    section: 'items',
    icon: (
      <>
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
        <path d="M4 7.5 12 12l8-4.5M12 12v9" />
      </>
    ),
  },
  {
    href: '/estimates',
    label: 'Estimates',
    section: 'estimates',
    icon: (
      <>
        <path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M15 3v4h4M9 12h6M9 16h4" />
        <path d="m8 8 1 1 2-2" />
      </>
    ),
  },
  {
    href: '/invoices',
    label: 'Invoices',
    section: 'invoices',
    icon: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6M8 13h8M8 17h5" />
      </>
    ),
  },
  {
    href: '/payments',
    label: 'Payments',
    section: 'payments',
    icon: (
      <>
        <path d="M3 7h18v10H3z" />
        <path d="M3 10h18" />
        <circle cx="17" cy="14" r="1.2" />
      </>
    ),
  },
  {
    href: '/',
    label: 'Banking',
    comingSoon: true,
    icon: (
      <>
        <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
      </>
    ),
  },
  {
    href: '/',
    label: 'Reports',
    comingSoon: true,
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
];

export function AppSpine({
  active,
  org,
}: {
  active: SpineSection;
  org: ActiveOrganization | null;
}) {
  const router = useRouter();

  return (
    <aside className="spine" id="spine">
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

      <a className="org__button" href="/">
        <span>
          <span className="org__name">{org?.organizationName}</span>
          <span className="org__meta">
            {(org?.role ?? '').charAt(0) + (org?.role ?? '').slice(1).toLowerCase()}
          </span>
        </span>
      </a>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => {
          const isActive = item.section === active;
          return (
            <a
              key={item.label}
              className={`nav__item${isActive ? ' is-active' : ''}`}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.comingSoon ? `${item.label}, coming soon` : undefined}
            >
              <svg className="icon nav__icon" viewBox="0 0 24 24" aria-hidden="true">
                {item.icon}
              </svg>
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="spine__foot">
        <span className="spine__label">Signed in</span>
        <button
          className="spine-signout"
          type="button"
          onClick={() => {
            clearSession();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
