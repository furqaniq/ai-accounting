import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import PDFParser from 'pdf2json';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface InvoiceView {
  id: string;
  number: string;
}

function binaryParser(
  res: any,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
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

describe('Invoice PDF', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let customerId: string;
  let hourlyItemId: string;
  let packageItemId: string;
  let invoiceId: string;
  let invoiceNumber: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    await prisma.invoice.deleteMany({ where: { notes: { startsWith: 'TEST PDF' } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await clearTestRows();

    [ownerToken, staffToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('staff@acme.test'),
      login('viewer@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await call('get', '/auth/me', ownerToken, '').expect(200);
    acmeId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Nimbus Retail LLC',
    ).organizationId;

    const customers = await call('get', '/customers', ownerToken, acmeId).expect(200);
    customerId = (customers.body.customers as Array<{ id: string; name: string }>).find(
      (customer) => customer.name === 'Northwind Studio',
    )!.id;

    const items = await call('get', '/items', ownerToken, acmeId).expect(200);
    hourlyItemId = (items.body.items as Array<{ id: string; name: string }>).find(
      (item) => item.name === 'Consulting hour',
    )!.id;
    packageItemId = (items.body.items as Array<{ id: string; name: string }>).find(
      (item) => item.name === 'Design package',
    )!.id;

    const created = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        taxRate: 0.0825,
        notes: 'TEST PDF invoice',
        lines: [
          { itemId: hourlyItemId, quantity: 2, unitPrice: 150 },
          { itemId: packageItemId, quantity: 1, unitPrice: 900 },
        ],
      })
      .expect(201);
    invoiceId = (created.body as InvoiceView).id;
    invoiceNumber = (created.body as InvoiceView).number;
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('returns a downloadable PDF with the invoice content', async () => {
    const res = await call('get', `/invoices/${invoiceId}/pdf`, viewerToken, acmeId)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${invoiceNumber}.pdf"`,
    );
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');

    const text = await pdfText(body);
    expect(text).toContain('Acme Services Co.');
    expect(text).toContain('Invoice');
    expect(text).toContain(invoiceNumber);
    expect(text).toContain('Northwind Studio');
    expect(text).toContain('Consulting hour');
    expect(text).toContain('Design package');
    expect(text).toContain('Nov 1, 2026');
    expect(text).toContain('Dec 1, 2026');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('$74.25');
    expect(text).toContain('$1,274.25');
    expect(text).toContain('Balance due');
  });

  it('rejects cross-tenant invoice ids without leaking the invoice', async () => {
    await call('get', `/invoices/${invoiceId}/pdf`, nimbusOwnerToken, nimbusId).expect(404);
    await call('get', `/invoices/${invoiceId}/pdf`, viewerToken, acmeId).expect(200);
  });
});
