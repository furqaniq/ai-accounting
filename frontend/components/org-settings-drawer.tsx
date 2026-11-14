'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ActiveOrganization, OrgSettings, fetchSettings, saveSettings } from '@/lib/api';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface Props {
  open: boolean;
  onClose: () => void;
  activeOrg: ActiveOrganization | null;
  canManage: boolean;
  onSaved: (settings: OrgSettings) => void;
  onToast: (message: string) => void;
}

export default function OrgSettingsDrawer({
  open,
  onClose,
  activeOrg,
  canManage,
  onSaved,
  onToast,
}: Props) {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [name, setName] = useState('');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [currency, setCurrency] = useState('USD');
  const [taxPercent, setTaxPercent] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback((next: OrgSettings) => {
    setSettings(next);
    setName(next.name);
    setMonth(next.fiscalYearStartMonth);
    setDay(next.fiscalYearStartDay);
    setCurrency(next.baseCurrency);
    setTaxPercent((next.defaultTaxRate * 100).toFixed(2).replace(/\.?0+$/, ''));
  }, []);

  useEffect(() => {
    if (!open || !activeOrg) return;
    let cancelled = false;
    setError(null);
    fetchSettings(activeOrg.organizationId)
      .then((next) => {
        if (!cancelled) hydrate(next);
      })
      .catch(() => {
        if (!cancelled) setError('Settings are not available right now.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeOrg, hydrate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrg || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveSettings(activeOrg.organizationId, {
        name: name.trim(),
        fiscalYearStartMonth: month,
        fiscalYearStartDay: day,
        baseCurrency: currency.trim().toUpperCase(),
        defaultTaxRate: Number(taxPercent) / 100,
      });
      hydrate(next);
      onSaved(next);
      onToast('Settings saved to the book.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save those settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className={`margin side-drawer${open ? ' is-open' : ''}`}
      id="settings"
      aria-label="Organization settings"
    >
      <div className="margin__head">
        <span className="members__mark" aria-hidden="true">
          <svg className="icon icon--sm" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5v4.7l3 1.8" />
          </svg>
        </span>
        <h2 className="margin__title">Settings</h2>
        <span className="margin__status">{activeOrg?.organizationName ?? ''}</span>
        <button
          className="icon-btn margin__close"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error ? (
        <p className="members__error" role="alert">
          {error}
        </p>
      ) : null}

      {!settings ? (
        <p className="members__empty">Opening the book…</p>
      ) : canManage ? (
        <form className="drawer-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="drawer-form__label" htmlFor="settings-name">
            Organization name
          </label>
          <input
            id="settings-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <fieldset className="drawer-form__group">
            <legend className="drawer-form__label">Fiscal year starts</legend>
            <div className="drawer-form__pair">
              <label className="sr-only" htmlFor="settings-month">
                Fiscal year start month
              </label>
              <select
                id="settings-month"
                value={month}
                onChange={(event) => setMonth(Number(event.target.value))}
              >
                {MONTHS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="settings-day">
                Fiscal year start day
              </label>
              <input
                id="settings-day"
                type="number"
                min={1}
                max={31}
                value={day}
                onChange={(event) => setDay(Number(event.target.value))}
              />
            </div>
          </fieldset>

          <label className="drawer-form__label" htmlFor="settings-currency">
            Base currency
          </label>
          <input
            id="settings-currency"
            required
            maxLength={3}
            pattern="[A-Za-z]{3}"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />

          <label className="drawer-form__label" htmlFor="settings-tax">
            Default tax rate (%)
          </label>
          <input
            id="settings-tax"
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={taxPercent}
            onChange={(event) => setTaxPercent(event.target.value)}
          />

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              Save settings
            </button>
            <span className="drawer-form__hint">These rules shape forms and reports.</span>
          </div>
        </form>
      ) : (
        <dl className="drawer-read">
          <dt>Name</dt>
          <dd>{settings.name}</dd>
          <dt>Fiscal year starts</dt>
          <dd>
            {MONTHS[settings.fiscalYearStartMonth - 1]} {settings.fiscalYearStartDay}
          </dd>
          <dt>Base currency</dt>
          <dd>{settings.baseCurrency}</dd>
          <dt>Default tax rate</dt>
          <dd>{(settings.defaultTaxRate * 100).toFixed(2)}%</dd>
          <p className="members__note">
            Only owners and admins can change these settings.
          </p>
        </dl>
      )}
    </aside>
  );
}
