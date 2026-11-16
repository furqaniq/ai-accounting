import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import {
  DomainEvent,
  DomainEventsService,
} from '../events/domain-events.service';
import { PrismaService } from '../prisma/prisma.service';

const TEST_PREFIX = 'PW EVT';
const BANK_PREFIX = 'PW EVT BANK';

describe('Feature services emit domain events', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventsService;
  let unsubscribe: (() => void) | undefined;
  let received: DomainEvent[] = [];
  let ownerToken: string;
  let staffToken: string;
  let acmeId: string;
  let rentAccountId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(method: 'get' | 'post', path: string, token: string) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', acmeId);
  }

  async function cleanup(): Promise<void> {
    const vendors = await prisma.vendor.findMany({
      where: { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (vendors.length > 0) {
      const vendorIds = vendors.map((vendor) => vendor.id);
      const bills = await prisma.bill.findMany({
        where: { organizationId: acmeId, vendorId: { in: vendorIds } },
        select: { id: true },
      });
      if (bills.length > 0) {
        await prisma.journalEntry.deleteMany({
          where: { sourceType: 'BILL', sourceId: { in: bills.map((bill) => bill.id) } },
        });
        await prisma.billLine.deleteMany({
          where: { billId: { in: bills.map((bill) => bill.id) } },
        });
        await prisma.bill.deleteMany({ where: { id: { in: bills.map((bill) => bill.id) } } });
      }
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }

    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: acmeId, name: { startsWith: BANK_PREFIX } },
      select: { id: true, ledgerAccountId: true },
    });
    const accountIds = accounts.map((account) => account.id);
    if (accountIds.length > 0) {
      await prisma.reconciliationSession.deleteMany({
        where: { bankAccountId: { in: accountIds } },
      });
      await prisma.bankTransaction.deleteMany({
        where: { bankAccountId: { in: accountIds } },
      });
      await prisma.bankImportBatch.deleteMany({
        where: { bankAccountId: { in: accountIds } },
      });
      await prisma.bankAccount.deleteMany({ where: { id: { in: accountIds } } });
      await prisma.account.deleteMany({
        where: { id: { in: accounts.map((account) => account.ledgerAccountId) } },
      });
    }
  }

  async function createBankAccount(code: string): Promise<string> {
    const ledger = await call('post', '/accounts', ownerToken)
      .send({ code, name: `${BANK_PREFIX} ledger`, type: 'ASSET' })
      .expect(201);
    const bank = await call('post', '/bank-accounts', staffToken)
      .send({
        name: `${BANK_PREFIX} ${code}`,
        type: 'CHECKING',
        ledgerAccountId: ledger.body.id,
      })
      .expect(201);
    return bank.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    events = app.get(DomainEventsService);

    [ownerToken, staffToken] = await Promise.all([
      login('owner@acme.test'),
      login('staff@acme.test'),
    ]);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    acmeId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Acme Services Co.',
    ).organizationId;
    const accounts = await call('get', '/accounts', ownerToken).expect(200);
    const rows = accounts.body.accounts as Array<{ id: string; code: string }>;
    rentAccountId = rows.find((row) => row.code === '6000')!.id;
    await cleanup();
    unsubscribe = events.subscribe((event) => {
      received.push(event);
    });
  });

  beforeEach(async () => {
    received = [];
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    unsubscribe?.();
    await cleanup();
    await app.close();
  });

  it('emits one event per imported bank transaction', async () => {
    const bankAccountId = await createBankAccount('1961');
    const csv = 'Date,Description,Amount,Reference\n2026-11-16,PW EVT DEPOSIT,321.50,PW-EVT-1\n';
    const res = await call('post', '/bank-imports', staffToken)
      .field('bankAccountId', bankAccountId)
      .attach('file', Buffer.from(csv), {
        filename: 'pw-event-bank.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    const transactionId = res.body.transactions[0].id as string;

    const event = received.find(
      (row) => row.type === 'BANK_TRANSACTION_IMPORTED' && row.entityId === transactionId,
    );
    expect(event).toBeTruthy();
    expect(event).toMatchObject({
      organizationId: acmeId,
      entityType: 'BankTransaction',
      data: {
        transactionId,
        bankAccountId,
        description: 'PW EVT DEPOSIT',
        amount: 321.5,
      },
    });
  });

  it('emits an event when a bill opens', async () => {
    const vendorRes = await call('post', '/vendors', staffToken)
      .send({ name: `${TEST_PREFIX} Vendor` })
      .expect(201);
    const billRes = await call('post', '/bills', staffToken)
      .send({
        vendorId: vendorRes.body.id,
        issueDate: '2026-11-10',
        dueDate: '2026-12-10',
        lines: [
          {
            description: 'PW EVT service',
            quantity: 1,
            unitPrice: 420,
            expenseAccountId: rentAccountId,
          },
        ],
      })
      .expect(201);
    await call('post', `/bills/${billRes.body.id}/open`, staffToken).expect(201);

    const event = received.find(
      (row) => row.type === 'BILL_OPENED' && row.entityId === billRes.body.id,
    );
    expect(event).toBeTruthy();
    expect(event?.data).toMatchObject({
      billId: billRes.body.id,
      vendorName: `${TEST_PREFIX} Vendor`,
      total: 420,
    });
  });

  it('emits a discrepancy event when a reconciliation does not balance', async () => {
    const bankAccountId = await createBankAccount('1962');
    const res = await call('post', '/reconciliations', staffToken)
      .send({
        bankAccountId,
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        statementEndingBalance: 500,
      })
      .expect(201);

    const event = received.find(
      (row) =>
        row.type === 'RECONCILIATION_DISCREPANCY' &&
        row.entityId === res.body.id,
    );
    expect(event).toBeTruthy();
    expect(event?.data).toMatchObject({
      sessionId: res.body.id,
      bankAccountId,
      difference: 500,
    });
  });

  it('does not emit a discrepancy event for a balanced reconciliation start', async () => {
    const bankAccountId = await createBankAccount('1963');
    const res = await call('post', '/reconciliations', staffToken)
      .send({
        bankAccountId,
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        statementEndingBalance: 0,
      })
      .expect(201);
    expect(res.body.difference).toBe(0);
    expect(
      received.some(
        (row) =>
          row.type === 'RECONCILIATION_DISCREPANCY' &&
          row.entityId === res.body.id,
      ),
    ).toBe(false);
  });
});
