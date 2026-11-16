import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import PDFParser from 'pdf2json';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';

type ReportSlug =
  | 'profit-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'trial-balance'
  | 'sales-by-customer'
  | 'sales-by-item'
  | 'expenses-by-category';

function binaryParser(
  res: any,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function pdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataReady', (data: any) => {
      const pages = (data?.Pages ?? []) as Array<{
        Texts?: Array<{ R?: Array<{ T?: string }> }>;
      }>;
      const text = pages
        .flatMap((page) => page.Texts ?? [])
        .flatMap((item) => item.R ?? [])
        .map((run) => {
          try {
            return decodeURIComponent(run.T ?? '');
          } catch {
            return run.T ?? '';
          }
        })
        .join('\n');
      resolve(text);
    });
    parser.on('pdfParser_dataError', reject);
    parser.parseBuffer(buffer);
  });
}

describe('Report exports', () => {
  let app: INestApplication;
  let ownerToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(path: string, token: string, orgId: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function csv(
    slug: ReportSlug,
    query: string,
    token = ownerToken,
    orgId = acmeId,
  ): Promise<{ rows: string[][]; text: string; headers: Record<string, string> }> {
    const res = await call(`/reports/${slug}/export?format=csv&${query}`, token, orgId)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const text = (res.body as Buffer).toString('utf8');
    return { rows: parseCsv(text), text, headers: res.headers };
  }

  async function reportJson(
    slug: ReportSlug,
    query: string,
    token = ownerToken,
    orgId = acmeId,
  ): Promise<any> {
    const res = await call(`/reports/${slug}?${query}`, token, orgId).expect(200);
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    [ownerToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('viewer@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await call('/auth/me', ownerToken, '').expect(200);
    acmeId = me.body.memberships.find(
      (membership: { organizationName: string }) =>
        membership.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (membership: { organizationName: string }) =>
        membership.organizationName === 'Nimbus Retail LLC',
    ).organizationId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('exports the profit and loss statement as CSV with matching totals', async () => {
    const json = await reportJson('profit-loss', 'from=2026-01-01&to=2026-12-31');
    const { rows, headers } = await csv('profit-loss', 'from=2026-01-01&to=2026-12-31');

    expect(headers['content-type']).toContain('text/csv');
    expect(headers['content-disposition']).toBe(
      'attachment; filename="profit-loss-2026-01-01_2026-12-31.csv"',
    );
    expect(rows).toContainEqual(['Organization', 'Acme Services Co.']);
    expect(rows).toContainEqual(['Report', 'Profit & loss']);
    expect(rows).toContainEqual(['Period', '2026-01-01 to 2026-12-31']);
    expect(rows).toContainEqual([
      'Total income',
      '',
      json.totalIncome.toFixed(2),
    ]);
    expect(rows).toContainEqual([
      'Total expenses',
      '',
      json.totalExpenses.toFixed(2),
    ]);
    expect(rows).toContainEqual(['Net income', json.netIncome.toFixed(2)]);
  });

  it('exports the balance sheet as CSV with matching totals', async () => {
    const json = await reportJson('balance-sheet', 'asOf=2026-12-31');
    const { rows, headers } = await csv('balance-sheet', 'asOf=2026-12-31');

    expect(headers['content-disposition']).toBe(
      'attachment; filename="balance-sheet-2026-12-31.csv"',
    );
    expect(rows).toContainEqual(['Period', 'As of 2026-12-31']);
    expect(rows).toContainEqual(['Total assets', json.totalAssets.toFixed(2)]);
    expect(rows).toContainEqual([
      'Total liabilities and equity',
      json.totalLiabilitiesAndEquity.toFixed(2),
    ]);
    expect(rows).toContainEqual(['Notes']);
    expect(rows).toContainEqual(['Assets equal liabilities and equity.']);
  });

  it('exports the cash flow statement as CSV with matching totals', async () => {
    const json = await reportJson('cash-flow', 'from=2026-01-01&to=2026-12-31');
    const { rows } = await csv('cash-flow', 'from=2026-01-01&to=2026-12-31');

    expect(rows).toContainEqual(['Net change', json.netChange.toFixed(2)]);
    expect(rows).toContainEqual(['Ending cash', json.endingCash.toFixed(2)]);
    expect(rows).toContainEqual(['Beginning cash plus net movement equals ending cash.']);
  });

  it('exports the trial balance as CSV with matching totals', async () => {
    const json = await reportJson('trial-balance', 'asOf=2026-12-31');
    const { rows } = await csv('trial-balance', 'asOf=2026-12-31');

    expect(rows).toContainEqual([
      'Totals',
      '',
      json.totalDebit.toFixed(2),
      json.totalCredit.toFixed(2),
    ]);
    expect(rows).toContainEqual(['Total debits', json.totalDebit.toFixed(2)]);
    expect(rows).toContainEqual(['Debits equal credits.']);
  });

  it('exports sales by customer as CSV with grouped rows and totals', async () => {
    const json = await reportJson('sales-by-customer', 'from=2026-01-01&to=2026-12-31');
    const { rows } = await csv('sales-by-customer', 'from=2026-01-01&to=2026-12-31');

    expect(rows).toContainEqual([
      'Total sales',
      '',
      String(json.totals.count),
      String(json.totals.quantity),
      json.totals.amount.toFixed(2),
      json.totals.tax.toFixed(2),
      json.totals.total.toFixed(2),
    ]);
    expect(rows).toContainEqual(['Pre-tax sales', json.totals.amount.toFixed(2)]);
    expect(rows).toContainEqual(['Status', 'Reconciled']);
    expect(rows.some((row) => row.includes('Northwind Studio'))).toBe(true);
  });

  it('exports sales by item as CSV with grouped rows and totals', async () => {
    const json = await reportJson('sales-by-item', 'from=2026-01-01&to=2026-12-31');
    const { rows } = await csv('sales-by-item', 'from=2026-01-01&to=2026-12-31');

    expect(rows).toContainEqual([
      'Total sales',
      '',
      String(json.totals.count),
      String(json.totals.quantity),
      json.totals.amount.toFixed(2),
    ]);
    expect(rows.some((row) => row.includes('Consulting hour'))).toBe(true);
    expect(rows.some((row) => row.includes('INV-1001'))).toBe(true);
  });

  it('exports expenses by category as CSV with grouped rows and totals', async () => {
    const json = await reportJson('expenses-by-category', 'from=2026-01-01&to=2026-12-31');
    const { rows } = await csv('expenses-by-category', 'from=2026-01-01&to=2026-12-31');

    expect(rows).toContainEqual([
      'Total expenses',
      '',
      String(json.totals.count),
      json.totals.amount.toFixed(2),
    ]);
    expect(rows.some((row) => row.includes('Utilities expense'))).toBe(true);
    expect(rows.some((row) => row.includes('BILL-1002'))).toBe(true);
  });

  it('renders the profit and loss PDF with organization, title, and totals', async () => {
    const res = await call(
      '/reports/profit-loss/export?format=pdf&from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="profit-loss-2026-01-01_2026-12-31.pdf"',
    );
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');

    const text = await pdfText(body);
    expect(text).toContain('Acme Services Co.');
    expect(text).toContain('Profit & loss');
    expect(text).toContain('Jan 1, 2026 - Dec 31, 2026');
    expect(text).toContain('Total income');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('Total expenses');
    expect(text).toContain('$1,075.00');
    expect(text).toContain('Net income');
    expect(text).toContain('125.00');
  });

  it('renders the sales by customer PDF with organization, title, and totals', async () => {
    const res = await call(
      '/reports/sales-by-customer/export?format=pdf&from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    const text = await pdfText(res.body as Buffer);
    expect(text).toContain('Acme Services Co.');
    expect(text).toContain('Sales by customer');
    expect(text).toContain('Northwind Studio');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('$1,274.25');
    expect(text).toContain('Total sales');
  });

  it('rejects unknown reports, formats, and parameters', async () => {
    await call('/reports/nope/export?format=csv', ownerToken, acmeId).expect(400);
    await call('/reports/profit-loss/export?format=xlsx', ownerToken, acmeId).expect(400);
    await call('/reports/profit-loss/export', ownerToken, acmeId).expect(400);
    await call(
      '/reports/profit-loss/export?format=csv&bogus=1&from=2026-01-01&to=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(400);
    await call(
      '/reports/profit-loss/export?format=csv&asOf=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(400);
    await call(
      '/reports/balance-sheet/export?format=csv&from=2026-01-01&to=2026-12-31',
      ownerToken,
      acmeId,
    ).expect(400);
  });

  it('scopes exports to the active organization and grants viewers read access', async () => {
    const nimbus = await csv(
      'sales-by-customer',
      'from=2026-01-01&to=2026-12-31',
      nimbusOwnerToken,
      nimbusId,
    );
    expect(nimbus.rows).toContainEqual(['Organization', 'Nimbus Retail LLC']);
    expect(nimbus.text).not.toContain('Acme Services Co.');
    expect(nimbus.rows).toContainEqual(['Pre-tax sales', '240.00']);

    await call(
      '/reports/sales-by-customer/export?format=csv&from=2026-01-01&to=2026-12-31',
      nimbusOwnerToken,
      acmeId,
    ).expect(403);

    const viewer = await csv(
      'profit-loss',
      'from=2026-01-01&to=2026-12-31',
      viewerToken,
      acmeId,
    );
    expect(viewer.rows).toContainEqual(['Organization', 'Acme Services Co.']);
  });
});
