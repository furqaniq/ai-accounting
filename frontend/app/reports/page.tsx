'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  BalanceSheetReport,
  CashFlowReport,
  ExpensesByCategoryReport,
  ProfitLossReport,
  ReportAccountRow,
  SalesByCustomerReport,
  SalesByItemReport,
  StatementGroup,
  TrialBalanceReport,
  clearSession,
  downloadReportExport,
  fetchActiveOrganization,
  fetchBalanceSheet,
  fetchCashFlow,
  fetchExpensesByCategory,
  fetchProfitLoss,
  fetchSalesByCustomer,
  fetchSalesByItem,
  fetchTrialBalance,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
} from '@/lib/api';
import type { ReportExportFormat } from '@/lib/api';

type StatementTab = 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'trial-balance';
type AnalysisTab = 'sales-by-customer' | 'sales-by-item' | 'expenses-by-category';
type ReportTab = StatementTab | AnalysisTab;

type StatementReport =
  | ProfitLossReport
  | BalanceSheetReport
  | CashFlowReport
  | TrialBalanceReport;

type OperationalReport =
  | SalesByCustomerReport
  | SalesByItemReport
  | ExpensesByCategoryReport;

type Report = StatementReport | OperationalReport;

const TABS: Array<{ key: StatementTab; label: string }> = [
  { key: 'profit-loss', label: 'Profit & loss' },
  { key: 'balance-sheet', label: 'Balance sheet' },
  { key: 'cash-flow', label: 'Cash flow' },
  { key: 'trial-balance', label: 'Trial balance' },
];

const ANALYSIS_TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'sales-by-customer', label: 'Sales by customer' },
  { key: 'sales-by-item', label: 'Sales by item' },
  { key: 'expenses-by-category', label: 'Expenses by category' },
];

const TAB_LABELS: Record<ReportTab, string> = {
  ...(Object.fromEntries(TABS.map((tab) => [tab.key, tab.label])) as Record<StatementTab, string>),
  ...(Object.fromEntries(
    ANALYSIS_TABS.map((tab) => [tab.key, tab.label]),
  ) as Record<AnalysisTab, string>),
};

const ANALYSIS_KEYS = new Set<ReportTab>(ANALYSIS_TABS.map((tab) => tab.key));

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
  const [report, setReport] = useState<Report | null>(null);
  const [openRows, setOpenRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const [queryReady, setQueryReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && tabParam in TAB_LABELS) {
      setTab(tabParam as ReportTab);
    }
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const asOfParam = params.get('asOf');
    if (fromParam) setFrom(fromParam);
    if (toParam) setTo(toParam);
    if (asOfParam) setAsOf(asOfParam);
    setQueryReady(true);
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
    if (!org || !queryReady) return;
    let cancelled = false;
    setLoading(true);
    const load = async (): Promise<Report> => {
      if (tab === 'profit-loss') {
        return fetchProfitLoss(org.organizationId, { from, to });
      }
      if (tab === 'cash-flow') {
        return fetchCashFlow(org.organizationId, { from, to });
      }
      if (tab === 'balance-sheet') {
        return fetchBalanceSheet(org.organizationId, asOf);
      }
      if (tab === 'trial-balance') {
        return fetchTrialBalance(org.organizationId, asOf);
      }
      if (tab === 'sales-by-customer') {
        return fetchSalesByCustomer(org.organizationId, { from, to });
      }
      if (tab === 'sales-by-item') {
        return fetchSalesByItem(org.organizationId, { from, to });
      }
      return fetchExpensesByCategory(org.organizationId, { from, to });
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
  }, [org, tab, from, to, asOf, queryReady]);

  const periodTab = !(tab === 'balance-sheet' || tab === 'trial-balance');
  const analysisTab = ANALYSIS_KEYS.has(tab);
  const reportLabel = useMemo(() => {
    if (!report) return 'Reading the ledger.';
    if ('asOf' in report) {
      return `As of ${displayDate(report.asOf, 'long')}`;
    }
    return `${displayDate(report.from)} – ${displayDate(report.to, 'long')}`;
  }, [report]);

  function toggleSources(key: string) {
    setOpenRows((current) =>
      current.includes(key) ? current.filter((row) => row !== key) : [...current, key],
    );
  }

  async function exportReport(format: ReportExportFormat) {
    if (!org) return;
    setExporting(format);
    setExportError(null);
    try {
      const filters = periodTab ? { from, to } : { asOf };
      const { blob, filename } = await downloadReportExport(org.organizationId, tab, filters, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export that report');
    } finally {
      setExporting(null);
    }
  }

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

  function documentHref(type: 'invoice' | 'bill' | 'expense', id: string): string {
    if (type === 'invoice') return `/invoices?invoice=${id}`;
    if (type === 'bill') return `/bills?bill=${id}`;
    return `/expenses?expense=${id}`;
  }

  function reconciliationNote(reconciled: boolean, text: string) {
    return (
      <p className="report-note">
        <span className={`report-status${reconciled ? ' is-ok' : ' is-off'}`}>
          {reconciled ? 'Reconciled' : 'Does not tie to the ledger'}
        </span>{' '}
        {text}
      </p>
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

    if (report.report === 'sales-by-customer') {
      return (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">Pre-tax sales</div>
              <div className="stat__value">{money(report.totals.amount)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Tax collected</div>
              <div className="stat__value">{money(report.totals.tax)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Invoiced total</div>
              <div className="stat__value">{money(report.totals.total)}</div>
            </div>
          </div>
          <table className="report-table" aria-label="Sales by customer">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Documents</th>
                <th scope="col" className="num">Quantity</th>
                <th scope="col" className="num">Sales</th>
                <th scope="col" className="num">Tax</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="accounts-empty">
                    No posted invoices in this period.
                  </td>
                </tr>
              ) : (
                report.rows.map((row) => {
                  const key = `customer-${row.customerId}`;
                  const open = openRows.includes(key);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          {row.code} — {row.name}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="report-row-toggle"
                            aria-expanded={open}
                            onClick={() => toggleSources(key)}
                          >
                            {row.count} invoice{row.count === 1 ? '' : 's'}
                          </button>
                        </td>
                        <td className="num">{row.quantity}</td>
                        <td className="num">{money(row.amount)}</td>
                        <td className="num">{money(row.tax)}</td>
                        <td className="num">{money(row.total)}</td>
                      </tr>
                      {open ? (
                        <tr className="report-sources-row">
                          <td colSpan={6}>
                            <ul className="report-source-list">
                              {row.sources.map((source) => (
                                <li key={source.id}>
                                  <a
                                    className="invoice-link"
                                    href={documentHref('invoice', source.id)}
                                  >
                                    {source.number}
                                  </a>
                                  <span>
                                    {displayDate(source.date)} · {money(source.amount)} pre-tax
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="is-total">
                <td colSpan={2}>Total sales</td>
                <td className="num">{report.totals.quantity}</td>
                <td className="num">{money(report.totals.amount)}</td>
                <td className="num">{money(report.totals.tax)}</td>
                <td className="num">{money(report.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
          {reconciliationNote(
            report.reconciled,
            `Pre-tax sales ${money(report.totals.amount)} against posted income ${money(
              report.ledgerIncome,
            )}. Draft invoices are excluded until they post.`,
          )}
        </>
      );
    }

    if (report.report === 'sales-by-item') {
      return (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">Pre-tax sales</div>
              <div className="stat__value">{money(report.totals.amount)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Quantity sold</div>
              <div className="stat__value">{report.totals.quantity}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Invoice lines</div>
              <div className="stat__value">{report.totals.count}</div>
            </div>
          </div>
          <table className="report-table" aria-label="Sales by item">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Documents</th>
                <th scope="col" className="num">Quantity</th>
                <th scope="col" className="num">Sales</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="accounts-empty">
                    No posted invoices in this period.
                  </td>
                </tr>
              ) : (
                report.rows.map((row) => {
                  const key = `item-${row.itemId}`;
                  const open = openRows.includes(key);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          {row.code} — {row.name}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="report-row-toggle"
                            aria-expanded={open}
                            onClick={() => toggleSources(key)}
                          >
                            {row.count} line{row.count === 1 ? '' : 's'}
                          </button>
                        </td>
                        <td className="num">{row.quantity}</td>
                        <td className="num">{money(row.amount)}</td>
                      </tr>
                      {open ? (
                        <tr className="report-sources-row">
                          <td colSpan={4}>
                            <ul className="report-source-list">
                              {row.sources.map((source) => (
                                <li key={source.lineId}>
                                  <a
                                    className="invoice-link"
                                    href={documentHref('invoice', source.id)}
                                  >
                                    {source.number}
                                  </a>
                                  <span>
                                    {displayDate(source.date)} · {source.quantity} ×{' '}
                                    {money(source.amount)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="is-total">
                <td colSpan={2}>Total sales</td>
                <td className="num">{report.totals.quantity}</td>
                <td className="num">{money(report.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
          {reconciliationNote(
            report.reconciled,
            `Pre-tax sales ${money(report.totals.amount)} against posted income ${money(
              report.ledgerIncome,
            )}. Quantities come from posted invoice lines only.`,
          )}
        </>
      );
    }

    if (report.report === 'expenses-by-category') {
      return (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">Total expenses</div>
              <div className="stat__value">{money(report.totals.amount)}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Categories</div>
              <div className="stat__value">{report.rows.length}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Documents</div>
              <div className="stat__value">{report.totals.count}</div>
            </div>
          </div>
          <table className="report-table" aria-label="Expenses by category">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Documents</th>
                <th scope="col" className="num">Expense</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="accounts-empty">
                    No posted expenses in this period.
                  </td>
                </tr>
              ) : (
                report.rows.map((row) => {
                  const key = `category-${row.accountId}`;
                  const open = openRows.includes(key);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td>
                          {row.code} — {row.name}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="report-row-toggle"
                            aria-expanded={open}
                            onClick={() => toggleSources(key)}
                          >
                            {row.count} document{row.count === 1 ? '' : 's'}
                          </button>
                        </td>
                        <td className="num">{money(row.amount)}</td>
                      </tr>
                      {open ? (
                        <tr className="report-sources-row">
                          <td colSpan={3}>
                            <ul className="report-source-list">
                              {row.sources.map((source) => (
                                <li key={`${source.type}-${source.id}`}>
                                  <a
                                    className="invoice-link"
                                    href={documentHref(source.type, source.id)}
                                  >
                                    {source.number}
                                  </a>
                                  <span>
                                    {displayDate(source.date)} · {money(source.amount)}
                                    {source.party ? ` · ${source.party}` : ''}
                                    {source.memo ? ` · ${source.memo}` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="is-total">
                <td colSpan={2}>Total expenses</td>
                <td className="num">{money(report.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
          {reconciliationNote(
            report.reconciled,
            `Quick expenses plus pre-tax bill lines ${money(
              report.totals.amount,
            )} against posted expenses ${money(
              report.ledgerExpenses,
            )}. Draft bills and tax are excluded.`,
          )}
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
            <h1>Reports</h1>
            <p className="page-head__meta">
              {org?.organizationName}. {reportLabel}
              {loading ? ' Updating…' : ''}
            </p>
          </div>
          <div className="page-head__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => exportReport('csv')}
              disabled={exporting !== null}
            >
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => exportReport('pdf')}
              disabled={exporting !== null}
            >
              {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
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
              onClick={() => {
                setTab(item.key);
                setOpenRows([]);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="report-subtabs">
          <span className="report-subtabs__label">Analysis</span>
          <div className="report-tabs" role="tablist" aria-label="Operational analysis">
            {ANALYSIS_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                className="report-tab"
                aria-selected={tab === item.key}
                aria-controls="statement-panel"
                id={`tab-${item.key}`}
                onClick={() => {
                  setTab(item.key);
                  setOpenRows([]);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
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

          {exportError ? (
            <p className="members__error" role="alert">
              {exportError}
            </p>
          ) : null}

          <section className="report-sheet statement-sheet" aria-live="polite">
            <div className="report-sheet__head">
              <div>
                <h2>{TAB_LABELS[tab]}</h2>
                <p className="report-sheet__meta">
                  {org?.organizationName} · {reportLabel}
                </p>
              </div>
              <p className="report-sheet__meta">
                {analysisTab
                  ? 'Open a document to inspect its source.'
                  : 'Click an account to open its register.'}
              </p>
            </div>
            {renderReport()}
          </section>
        </section>
      </main>
    </div>
  );
}
