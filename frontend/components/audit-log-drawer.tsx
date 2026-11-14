'use client';

import { useEffect, useState } from 'react';
import { ActiveOrganization, AuditEntry, fetchAuditLog } from '@/lib/api';

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'membership.create', label: 'Member added' },
  { value: 'membership.role_change', label: 'Role changed' },
  { value: 'membership.delete', label: 'Member removed' },
  { value: 'org.settings.update', label: 'Settings updated' },
];

const RECORD_OPTIONS = [
  { value: '', label: 'All records' },
  { value: 'OrgMembership', label: 'Members' },
  { value: 'Organization', label: 'Organization settings' },
];

function actionLabel(action: string): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label ?? action;
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  fiscalYearStartMonth: 'Fiscal month',
  fiscalYearStartDay: 'Fiscal day',
  baseCurrency: 'Currency',
  defaultTaxRate: 'Tax rate',
};

function describe(entry: AuditEntry): string {
  const changes = entry.metadata?.changes as
    | Record<string, { from: unknown; to: unknown }>
    | undefined;
  if (changes) {
    return Object.entries(changes)
      .map(
        ([field, change]) =>
          `${FIELD_LABELS[field] ?? field}: ${String(change.from)} → ${String(change.to)}`,
      )
      .join(', ');
  }
  const email = entry.metadata?.email as string | undefined;
  const role = entry.metadata?.role as string | undefined;
  if (email) return role ? `${email} · ${role.toLowerCase()}` : email;
  return entry.entityType;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeOrg: ActiveOrganization | null;
}

export default function AuditLogDrawer({ open, onClose, activeOrg }: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeOrg) return;
    let cancelled = false;
    setError(null);
    fetchAuditLog(activeOrg.organizationId, {
      action: action || undefined,
      entityType: entityType || undefined,
      limit: 50,
    })
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch(() => {
        if (!cancelled) setError('The audit log is not available right now.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeOrg, action, entityType]);

  return (
    <aside
      className={`margin side-drawer${open ? ' is-open' : ''}`}
      id="audit-log"
      aria-label="Audit log"
    >
      <div className="margin__head">
        <span className="members__mark" aria-hidden="true">
          <svg className="icon icon--sm" viewBox="0 0 24 24">
            <path d="M5 4h14v16H5z" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        </span>
        <h2 className="margin__title">Audit log</h2>
        <span className="margin__status">{activeOrg?.organizationName ?? ''}</span>
        <button
          className="icon-btn margin__close"
          type="button"
          aria-label="Close audit log"
          onClick={onClose}
        >
          <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="audit-filters">
        <label className="sr-only" htmlFor="audit-action">
          Filter by action
        </label>
        <select
          id="audit-action"
          value={action}
          onChange={(event) => {
            setEntries(null);
            setAction(event.target.value);
          }}
        >
          {ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="audit-record">
          Filter by record
        </label>
        <select
          id="audit-record"
          value={entityType}
          onChange={(event) => {
            setEntries(null);
            setEntityType(event.target.value);
          }}
        >
          {RECORD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="members__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="audit-list">
        {entries === null ? (
          <p className="members__empty">Turning the ledger back…</p>
        ) : entries.length === 0 ? (
          <p className="members__empty">Nothing recorded for this filter yet.</p>
        ) : (
          entries.map((entry) => (
            <div className="audit-row" key={entry.id}>
              <div className="audit-row__head">
                <span className="audit-row__action">{actionLabel(entry.action)}</span>
                <span className="audit-row__time">{stamp(entry.createdAt)}</span>
              </div>
              <p className="audit-row__detail">{describe(entry)}</p>
              <p className="audit-row__actor">{entry.actor.email}</p>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
