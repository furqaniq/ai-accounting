'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  AgingBucket,
  AgingBucketKey,
  AgingInvoice,
  ArAgingReport,
  clearSession,
  fetchActiveOrganization,
  fetchArAging,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
} from '@/lib/api';

interface Drill {
  customerId: string;
  bucket: AgingBucketKey;
}

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

function bucketAmount(customer: ArAgingReport['customers'][number], bucket: AgingBucketKey) {
  if (bucket === 'current') return customer.current;
  if (bucket === '1-30') return customer.days1To30;
  if (bucket === '31-60') return customer.days31To60;
  if (bucket === '61-90') return customer.days61To90;
  return customer.days90Plus;
}

function invoiceLink(invoice: AgingInvoice): string {
  return `/invoices?invoice=${invoice.id}`;
}

export default function ArAgingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState<ArAgingReport | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
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

  useEffect(() => {
    if (!org || !asOf) return;
    let cancelled = false;
    setLoading(true);
    fetchArAging(org.organizationId, asOf)
      .then((rows) => {
        if (cancelled) return;
        setReport(rows);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The aging report is not available');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, asOf]);

  useEffect(() => {
    if (!drill) return;
    const timer = window.setTimeout(() => {
      document.getElementById('aging-drill')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [drill]);

  const overdueTotal = useMemo(
    () =>
      report?.buckets
        .filter((bucket) => bucket.key !== 'current')
        .reduce((sum, bucket) => sum + bucket.amount, 0) ?? 0,
    [report],
  );

  const drillCustomer = report?.customers.find(
    (customer) => customer.customerId === drill?.customerId,
  );
  const drillBucket = report?.buckets.find((bucket) => bucket.key === drill?.bucket);
  const drillInvoices = useMemo(
    () =>
      report?.invoices.filter(
        (invoice) =>
          invoice.customerId === drill?.customerId && invoice.bucket === drill?.bucket,
      ) ?? [],
    [drill, report],
  );

  function chooseBucket(customerId: string, bucket: AgingBucketKey) {
    setDrill({ customerId, bucket });
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Aging the receivables…</p>
      </main>
    );
  }

  return (
    <div className="app-shell app-shell--accounts">
      <AppSpine active="reports" org={org} />

      <main className="page" id="main">
        <header className="page-head">
          <div>
            <h1>AR aging</h1>
            <p className="page-head__meta">
              Open customer balances as of {displayDate(asOf, 'long')}.{' '}
              {report ? `${report.customers.length} customer${report.customers.length === 1 ? '' : 's'} with a balance.` : 'Loading the ledger.'}
            </p>
          </div>
          <div className="page-head__actions aging-asof">
            <label htmlFor="aging-asof">As of date</label>
            <input
              id="aging-asof"
              type="date"
              value={asOf}
              onChange={(event) => {
                setDrill(null);
                setAsOf(event.target.value);
              }}
            />
          </div>
        </header>

        <div className="stats">
          <div className="stat">
            <div className="stat__label">Receivables</div>
            <div className="stat__value">{report ? money(report.total) : '—'}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Overdue</div>
            <div className="stat__value is-negative">{report ? money(overdueTotal) : '—'}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Overdue invoices</div>
            <div className="stat__value">{report?.overdue.length ?? '—'}</div>
          </div>
        </div>

        {error ? (
          <p className="members__error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="report-sheet aging-sheet" aria-labelledby="aging-title">
          <div className="report-sheet__head">
            <div>
              <h2 id="aging-title">Receivables aging</h2>
              <p className="report-sheet__meta">
                {org?.organizationName} · {displayDate(asOf)} · open invoices by days past due.
              </p>
            </div>
            <p className="report-sheet__meta">Click a bucket to inspect its invoices.</p>
          </div>

          <div className="table-scroll">
            <table className="report-table aging-table">
              <caption className="sr-only">
                Open customer balances grouped into current, 1–30, 31–60, 61–90, and 90+ day buckets
              </caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  {report?.buckets.map((bucket) => (
                    <th scope="col" className="num" key={bucket.key}>
                      {bucket.label}
                    </th>
                  )) ?? (
                    <>
                      <th scope="col" className="num">Current</th>
                      <th scope="col" className="num">1–30</th>
                      <th scope="col" className="num">31–60</th>
                      <th scope="col" className="num">61–90</th>
                      <th scope="col" className="num">90+</th>
                    </>
                  )}
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {loading && !report ? (
                  <tr>
                    <td colSpan={7} className="accounts-empty">
                      Aging the ledger…
                    </td>
                  </tr>
                ) : !report || report.customers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="accounts-empty">
                      No open receivables as of this date.
                    </td>
                  </tr>
                ) : (
                  report.customers.map((customer) => (
                    <tr key={customer.customerId}>
                      <th scope="row" className="aging-customer">
                        <span>{customer.customerName}</span>
                        <span className="aging-customer__code">{customer.customerCode}</span>
                      </th>
                      {report.buckets.map((bucket) => {
                        const amount = bucketAmount(customer, bucket.key);
                        return (
                          <td className="num" key={bucket.key}>
                            {amount > 0 ? (
                              <button
                                className="aging-cell"
                                type="button"
                                aria-label={`View ${customer.customerName} ${bucket.label} invoices`}
                                onClick={() => chooseBucket(customer.customerId, bucket.key)}
                              >
                                {money(amount)}
                              </button>
                            ) : (
                              <span className="aging-empty">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num aging-customer-total">{money(customer.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="is-total">
                  <th scope="row">Total</th>
                  {report?.buckets.map((bucket: AgingBucket) => (
                    <td className="num" key={bucket.key}>
                      {money(bucket.amount)}
                    </td>
                  )) ?? (
                    <>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                    </>
                  )}
                  <td className="num">{report ? money(report.total) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="report-note">
            Balances reflect invoices issued on or before the selected date, less receipts dated on
            or before that date. Draft invoices are excluded until sent.
          </p>
        </section>

        {drill && drillInvoices.length > 0 ? (
          <section className="invoice-detail aging-drill" id="aging-drill" aria-labelledby="drill-title">
            <div className="invoice-detail__head">
              <div>
                <h2 id="drill-title">
                  {drillCustomer?.customerName} · {drillBucket?.label}
                </h2>
                <p className="invoice-detail__meta">
                  {drillInvoices.length} open invoice{drillInvoices.length === 1 ? '' : 's'} ·{' '}
                  {money(drillInvoices.reduce((sum, invoice) => sum + invoice.balanceDue, 0))}
                </p>
              </div>
              <div className="invoice-detail__actions">
                <button className="btn btn--ghost" type="button" onClick={() => setDrill(null)}>
                  Close
                </button>
              </div>
            </div>

            <div className="table-scroll">
              <table className="line-table aging-drill__table">
                <caption className="sr-only">Invoices in this aging bucket</caption>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Due</th>
                    <th scope="col" className="num">Days overdue</th>
                    <th scope="col" className="num">Balance</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {drillInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <a className="invoice-link" href={invoiceLink(invoice)}>
                          {invoice.number}
                        </a>
                      </td>
                      <td>{displayDate(invoice.issueDate)}</td>
                      <td>{displayDate(invoice.dueDate)}</td>
                      <td className="num">{invoice.daysOverdue || '—'}</td>
                      <td className="num">{money(invoice.balanceDue)}</td>
                      <td className="action">
                        <a className="btn btn--ghost btn--sm" href={invoiceLink(invoice)}>
                          Open invoice
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="aging-overdue" aria-labelledby="overdue-title">
          <div className="section__head">
            <div>
              <h2 id="overdue-title">Overdue queue</h2>
              <p className="section__meta">Oldest and largest balances first. Open an invoice to follow up.</p>
            </div>
            <p className="section__meta">{report?.overdue.length ?? 0} overdue</p>
          </div>

          <div className="table-scroll">
            <table className="data-table invoice-table aging-overdue__table">
              <caption className="sr-only">Overdue invoices with days overdue</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="num">Days overdue</th>
                  <th scope="col" className="num">Balance</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {!report ? (
                  <tr>
                    <td colSpan={6} className="accounts-empty">Turning the pages…</td>
                  </tr>
                ) : report.overdue.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="accounts-empty">No overdue invoices as of this date.</td>
                  </tr>
                ) : (
                  report.overdue.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <a className="invoice-link" href={invoiceLink(invoice)}>
                          {invoice.number}
                        </a>
                      </td>
                      <td>{invoice.customerName}</td>
                      <td>{displayDate(invoice.dueDate)}</td>
                      <td className="num">{invoice.daysOverdue}</td>
                      <td className="num">{money(invoice.balanceDue)}</td>
                      <td className="action">
                        <a className="btn btn--ghost btn--sm" href={invoiceLink(invoice)}>
                          Open invoice
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
