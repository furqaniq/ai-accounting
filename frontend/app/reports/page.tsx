'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  BalanceSheetReport,
  CashFlowReport,
  ProfitLossReport,
  ReportAccountRow,
  StatementGroup,
  TrialBalanceReport,
  clearSession,
  fetchActiveOrganization,
  fetchBalanceSheet,
  fetchCashFlow,
  fetchProfitLoss,
  fetchTrialBalance,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
} from '@/lib/api';

type ReportTab = 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'trial-balance';

type StatementReport =
  | ProfitLossReport
  | BalanceSheetReport
  | CashFlowReport
  | TrialBalanceReport;

const TABS: Array<{ key: ReportTab; label: string }> = [
  { key: 'profit-loss', label: 'Profit & loss' },
  { key: 'balance-sheet', label: 'Balance sheet' },
  { key: 'cash-flow', label: 'Cash flow' },
  { key: 'trial-balance', label: 'Trial balance' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayDate(value: string, style: 'long' | 'short' = 'short'): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function accountLabel(row: ReportAccountRow): string {
  return row.code ? `${row.code} — ${row.name}` : row.name;
}


export default function ReportsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [tab, setTab] = useState<ReportTab>('profit-loss');
  const initialTo = useMemo(today, []);
  const [from, setFrom] = useState(`${initialTo.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(initialTo);
  const [asOf, setAsOf] = useState(initialTo);
  const [report, setReport] = useState<StatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        session.memberships.find((membership) => membership.organizationId === stored) ??
        session.memberships[0];
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

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setLoading(true);
    const load = async (): Promise<StatementReport> => {
      if (tab === 'profit-loss') {
        return fetchProfitLoss(org.organizationId, { from, to });
      }
      if (tab === 'cash-flow') {
        return fetchCashFlow(org.organizationId, { from, to });
      }
      if (tab === 'balance-sheet') {
        return fetchBalanceSheet(org.organizationId, asOf);
      }
      return fetchTrialBalance(org.organizationId, asOf);
    };
    load()
      .then((statement) => {
        if (cancelled) return;
        setReport(statement);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof Error ? err.message : 'That statement is not available');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, tab, from, to, asOf]);

  const periodTab = tab === 'profit-loss' || tab === 'cash-flow';
  const reportLabel = useMemo(() => {
    if (!report) return 'Reading the ledger.';
    if (report.report === 'balance-sheet' || report.report === 'trial-balance') {
      return `As of ${displayDate(report.asOf, 'long')}`;
    }
    return `${displayDate(report.from)} – ${displayDate(report.to, 'long')}`;
  }, [report]);

  function drillLink(accountId: string | null): string | null {
    if (!accountId) return null;
    const params = new URLSearchParams({ account: accountId });
    if (periodTab) {
      params.set('from', from);
      params.set('to', to);
    } else {
      params.set('to', asOf);
    }
    return `/ledger?${params.toString()}`;
  }

  function accountRow(row: ReportAccountRow) {
    const href = drillLink(row.accountId);
    return (
      <tr className="indent" key={row.accountId ?? row.name}>
        <td>{href ? <a className="invoice-link" href={href}>{accountLabel(row)}</a> : accountLabel(row)}</td>
        <td className="num">{money(row.amount)}</td>
      </tr>
    );
  }

  function groupedTable(
    statement: ProfitLossReport | BalanceSheetReport,
    options: { footerLabel: string; footerValue: number },
  ) {
    return (
      <table className="report-table" aria-label={`${options.footerLabel} statement`}>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {statement.groups.map((group: StatementGroup) => (
            <Fragment key={group.key}>
              <tr className="section-row">
                <td>{group.label}</td>
                <td />
              </tr>
              {group.accounts.length === 0 ? (
                <tr className="indent">
                  <td>No activity</td>
                  <td className="num">{money(0)}</td>
                </tr>
              ) : (
                group.accounts.map(accountRow)
              )}
              <tr className="is-subtotal">
                <td>Total {group.label.toLowerCase()}</td>
                <td className="num">{money(group.total)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="is-total">
            <td>{options.footerLabel}</td>
            <td className="num">{money(options.footerValue)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  function renderReport() {
    if (!report) {
      return (
        <p className="accounts-empty">
          {loading ? 'Assembling the statement…' : 'Choose a statement to read.'}
        </p>
      );
    }

    if (report.report === 'profit-loss') {
      return (
        <>
          {groupedTable(report, {
            footerLabel: 'Net income',
            footerValue: report.netIncome,
          })}
          <p className="report-note">
            Posted income less posted expenses for the selected period. Draft invoices and bills
            are excluded until they reach the ledger.
          </p>
        </>
      );
    }

    if (report.report === 'balance-sheet') {
      return (
        <>
          {groupedTable(report, {
            footerLabel: 'Total liabilities and equity',
            footerValue: report.totalLiabilitiesAndEquity,
          })}
          <p className="report-note">
            <span className={`report-status${report.balanced ? ' is-ok' : ' is-off'}`}>
              {report.balanced ? 'Balanced' : 'Out of balance'}
            </span>{' '}
            Assets {money(report.totalAssets)} · Liabilities {money(report.totalLiabilities)} ·
            Equity {money(report.totalEquity)}. Current earnings folds unclosed income and expense
            balances into equity, so closed retained earnings are not counted twice.
          </p>
        </>
      );
    }

    if (report.report === 'cash-flow') {
      return (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">Beginning cash</div>
              <div className="stat__value">{money(report.beginningCash)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Net change</div>
              <div className={`stat__value${report.netChange < 0 ? ' is-negative' : ''}`}>
                {money(report.netChange)}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">Ending cash</div>
              <div className="stat__value">{money(report.endingCash)}</div>
            </div>
          </div>
          <table className="report-table" aria-label="Cash flow statement">
            <thead>
              <tr>
                <th scope="col">Counterpart account</th>
                <th scope="col" className="num">Movement</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="section-row">
                    <td>{group.label}</td>
                    <td />
                  </tr>
                  {group.lines.length === 0 ? (
                    <tr className="indent">
                      <td>No activity</td>
                      <td className="num">{money(0)}</td>
                    </tr>
                  ) : (
                    group.lines.map((line) => (
                      <tr className="indent" key={line.accountId}>
                        <td>
                          <a className="invoice-link" href={drillLink(line.accountId) ?? '#'}>
                            {line.code} — {line.name}
                          </a>
                        </td>
                        <td className="num">{money(line.amount)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="is-subtotal">
                    <td>Net {group.label.toLowerCase()}</td>
                    <td className="num">{money(group.total)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="is-total">
                <td>Net change in cash</td>
                <td className="num">{money(report.netChange)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="report-note">
            <span className={`report-status${report.reconciled ? ' is-ok' : ' is-off'}`}>
              {report.reconciled ? 'Reconciled' : 'Unreconciled'}
            </span>{' '}
            Beginning cash + net movement = ending cash. Cash includes Cash 1000 and active bank
            ledger accounts ({report.cashAccounts.map((account) => account.code).join(', ') || 'none'}).
            Pure transfers between cash accounts are excluded.
          </p>
        </>
      );
    }

    return (
      <>
        <table className="report-table" aria-label="Trial balance">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="num">Debit</th>
              <th scope="col" className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="accounts-empty">No account activity as of this date.</td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <a className="invoice-link" href={drillLink(row.accountId) ?? '#'}>
                      {row.code} — {row.name}
                    </a>
                  </td>
                  <td className="num">{row.debit ? money(row.debit) : '—'}</td>
                  <td className="num">{row.credit ? money(row.credit) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="is-total">
              <td>Totals</td>
              <td className="num">{money(report.totalDebit)}</td>
              <td className="num">{money(report.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="report-note">
          <span className={`report-status${report.debitsEqualCredits ? ' is-ok' : ' is-off'}`}>
            {report.debitsEqualCredits ? 'Debits equal credits' : 'Debits do not equal credits'}
          </span>{' '}
          Each account shows its net balance in the debit or credit column as of the selected date.
        </p>
      </>
    );
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the report book…</p>
      </main>
    );
  }

  return (
    <div className="app-shell app-shell--accounts">
      <AppSpine active="reports" org={org} />

      <main className="page" id="main">
        <header className="page-head">
          <div>
            <h1>Financial statements</h1>
            <p className="page-head__meta">
              {org?.organizationName}. {reportLabel}
              {loading ? ' Updating…' : ''}
            </p>
          </div>
          <div className="page-head__actions">
            <a className="btn btn--ghost btn--sm" href="/reports/ar-aging">AR aging</a>
            <a className="btn btn--ghost btn--sm" href="/reports/ap-aging">AP aging</a>
          </div>
        </header>

        <div className="report-tabs" role="tablist" aria-label="Financial statements">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              className="report-tab"
              aria-selected={tab === item.key}
              aria-controls="statement-panel"
              id={`tab-${item.key}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section
          className="report-panel"
          id="statement-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
        >
          <div className="statement-controls">
            {periodTab ? (
              <>
                <label>
                  From
                  <input
                    type="date"
                    aria-label="From date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    aria-label="To date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                As of date
                <input
                  type="date"
                  aria-label="As of date"
                  value={asOf}
                  onChange={(event) => setAsOf(event.target.value)}
                />
              </label>
            )}
          </div>

          {error ? (
            <p className="members__error" role="alert">
              {error}
            </p>
          ) : null}

          <section className="report-sheet statement-sheet" aria-live="polite">
            <div className="report-sheet__head">
              <div>
                <h2>{TABS.find((item) => item.key === tab)?.label}</h2>
                <p className="report-sheet__meta">
                  {org?.organizationName} · {reportLabel}
                </p>
              </div>
              <p className="report-sheet__meta">Click an account to open its register.</p>
            </div>
            {renderReport()}
          </section>
        </section>
      </main>
    </div>
  );
}
