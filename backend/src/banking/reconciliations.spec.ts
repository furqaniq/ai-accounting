import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface ReconciliationView {
  id: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  statementEndingBalance: number;
  openingBalance: number;
  clearedTotal: number;
  clearedBalance: number;
  bookBalance: number;
  difference: number;
  balanced: boolean;
  status: string;
  completedAt: string | null;
  clearedCount: number;
  transactionCount: number;
  transactions: Array<{
    id: string;
    amount: number;
    cleared: boolean;
    clearedAt: string | null;
    clearedElsewhere: boolean;
  }>;
}

const TEST_PREFIX = 'TEST RECON';
const BANK_PREFIX = 'TEST RECON BANK';
const CSV_HEADERS = 'Date,Description,Amount,Reference';

function csvFile(rows: string, filename = 'test-reconciliation.csv') {
  return {
    filename,
    content: `${CSV_HEADERS}\n${rows}`,
    contentType: 'text/csv',
  };
}

describe('Bank reconciliation workbench', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let cashAccountId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(method: 'get' | 'post' | 'patch', path: string, token: string, orgId: string) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: acmeId, name: { startsWith: BANK_PREFIX } },
      select: { id: true, ledgerAccountId: true },
    });
    const accountIds = accounts.map((account) => account.id);
    const ledgerAccountIds = accounts.map((account) => account.ledgerAccountId);
    const transactions = await prisma.bankTransaction.findMany({
      where: { organizationId: acmeId, bankAccountId: { in: accountIds } },
      select: { id: true },
    });
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: acmeId, memo: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const entryIds = entries.map((entry) => entry.id);
    if (entryIds.length > 0) {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    if (transactions.length > 0) {
      await prisma.bankTransaction.deleteMany({
        where: { id: { in: transactions.map((transaction) => transaction.id) } },
      });
    }
    if (accountIds.length > 0) {
      await prisma.reconciliationSession.deleteMany({
        where: { bankAccountId: { in: accountIds } },
      });
      await prisma.bankImportBatch.deleteMany({
        where: { bankAccountId: { in: accountIds } },
      });
      await prisma.bankAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
    if (ledgerAccountIds.length > 0) {
      await prisma.account.deleteMany({ where: { id: { in: ledgerAccountIds } } });
    }
  }

  async function createBankAccount(): Promise<{
    bankAccountId: string;
    ledgerAccountId: string;
  }> {
    const account = await call('post', '/accounts', ownerToken, acmeId)
      .send({ code: '1901', name: `${TEST_PREFIX} ledger`, type: 'ASSET' })
      .expect(201);
    const bank = await call('post', '/bank-accounts', staffToken, acmeId)
      .send({
        name: `${BANK_PREFIX} Checking`,
        type: 'CHECKING',
        ledgerAccountId: account.body.id,
      })
      .expect(201);
    return { bankAccountId: bank.body.id, ledgerAccountId: account.body.id };
  }

  async function postJournal(
    date: string,
    ledgerAccountId: string,
    debit: number,
    memo: string,
  ): Promise<void> {
    await call('post', '/journal-entries', ownerToken, acmeId)
      .send({
        date,
        memo: `${TEST_PREFIX} ${memo}`,
        lines: [
          { accountId: ledgerAccountId, debit },
          { accountId: cashAccountId, credit: debit },
        ],
      })
      .expect(201);
  }

  async function importTransactions(bankAccountId: string): Promise<string[]> {
    const file = csvFile(
      [
        '2026-10-05,TEST RECON DEPOSIT,500.00,TEST-RECON-1',
        '2026-10-06,TEST RECON WITHDRAWAL,-200.00,TEST-RECON-2',
        '2026-11-05,TEST RECON OUTSIDE PERIOD,50.00,TEST-RECON-3',
      ].join('\n'),
    );
    const res = await call('post', '/bank-imports', staffToken, acmeId)
      .field('bankAccountId', bankAccountId)
      .attach('file', Buffer.from(file.content), {
        filename: file.filename,
        contentType: file.contentType,
      })
      .expect(201);
    return (res.body.transactions as Array<{ id: string }>).map((transaction) => transaction.id);
  }

  async function setup(): Promise<{
    bankAccountId: string;
    ledgerAccountId: string;
    session: ReconciliationView;
    outsideTransactionId: string;
  }> {
    const { bankAccountId, ledgerAccountId } = await createBankAccount();
    await postJournal('2026-09-30', ledgerAccountId, 1000, 'opening balance');
    await postJournal('2026-10-10', ledgerAccountId, 150, 'mid-period book entry');
    const transactionIds = await importTransactions(bankAccountId);
    const started = await call('post', '/reconciliations', staffToken, acmeId)
      .send({
        bankAccountId,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        statementEndingBalance: 1300,
      })
      .expect(201);
    return {
      bankAccountId,
      ledgerAccountId,
      session: started.body as ReconciliationView,
      outsideTransactionId: transactionIds[2],
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);

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
    await clearTestRows();

    const accounts = await call('get', '/accounts', ownerToken, acmeId).expect(200);
    cashAccountId = (accounts.body.accounts as Array<{ id: string; code: string }>).find(
      (account) => account.code === '1000',
    )!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('starts, lists, and resumes a tenant-scoped reconciliation session', async () => {
    const { session, bankAccountId } = await setup();

    expect(session).toMatchObject({
      bankAccountId,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      statementEndingBalance: 1300,
      openingBalance: 1000,
      clearedTotal: 0,
      clearedBalance: 1000,
      bookBalance: 1150,
      difference: 300,
      balanced: false,
      status: 'ACTIVE',
      clearedCount: 0,
      transactionCount: 2,
    });
    expect(session.transactions.map((row) => row.id)).toHaveLength(2);
    expect(session.transactions.every((row) => !row.cleared)).toBe(true);

    const listed = await call('get', '/reconciliations', viewerToken, acmeId).expect(200);
    expect(
      (listed.body.sessions as Array<{ id: string }>).some((row) => row.id === session.id),
    ).toBe(true);

    const resumed = await call('get', `/reconciliations/${session.id}`, viewerToken, acmeId)
      .expect(200);
    expect(resumed.body).toMatchObject({
      id: session.id,
      difference: 300,
      transactionCount: 2,
    });

    await call('post', '/reconciliations', staffToken, acmeId)
      .send({
        bankAccountId,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        statementEndingBalance: 1300,
      })
      .expect(409);

    await call('get', `/reconciliations/${session.id}`, nimbusOwnerToken, nimbusId).expect(404);
    const nimbusList = await call('get', '/reconciliations', nimbusOwnerToken, nimbusId)
      .expect(200);
    expect(
      (nimbusList.body.sessions as Array<{ id: string }>).some((row) => row.id === session.id),
    ).toBe(false);

    await call('post', '/reconciliations', viewerToken, acmeId)
      .send({
        bankAccountId,
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        statementEndingBalance: 0,
      })
      .expect(403);

    const audit = await call(
      'get',
      '/audit-log?action=reconciliation.start&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === session.id),
    ).toMatchObject({
      entityType: 'ReconciliationSession',
      action: 'reconciliation.start',
      metadata: { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
    });
  });

  it('marks and unmarks cleared transactions, recalculating and persisting the difference', async () => {
    const { session, bankAccountId, outsideTransactionId } = await setup();
    const deposit = session.transactions.find((row) => row.amount === 500)!;
    const withdrawal = session.transactions.find((row) => row.amount === -200)!;

    const clearedDeposit = await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${deposit.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: true })
      .expect(200);
    expect(clearedDeposit.body).toMatchObject({
      clearedTotal: 500,
      clearedBalance: 1500,
      difference: -200,
      balanced: false,
      clearedCount: 1,
    });
    expect(
      clearedDeposit.body.transactions.find((row: { id: string }) => row.id === deposit.id),
    ).toMatchObject({ cleared: true, clearedAt: expect.any(String) });

    const clearedBoth = await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${withdrawal.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: true })
      .expect(200);
    expect(clearedBoth.body).toMatchObject({
      clearedTotal: 300,
      clearedBalance: 1300,
      bookBalance: 1150,
      difference: 0,
      balanced: true,
      clearedCount: 2,
    });

    const persisted = await call(
      'get',
      `/reconciliations/${session.id}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(persisted.body).toMatchObject({
      clearedTotal: 300,
      clearedBalance: 1300,
      difference: 0,
      balanced: true,
      clearedCount: 2,
    });

    const unmarked = await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${withdrawal.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: false })
      .expect(200);
    expect(unmarked.body).toMatchObject({
      clearedTotal: 500,
      clearedBalance: 1500,
      difference: -200,
      balanced: false,
      clearedCount: 1,
    });

    await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${outsideTransactionId}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: true })
      .expect(404);

    const overlapping = await call('post', '/reconciliations', staffToken, acmeId)
      .send({
        bankAccountId,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-05',
        statementEndingBalance: 1500,
      })
      .expect(201);
    await call(
      'patch',
      `/reconciliations/${overlapping.body.id}/transactions/${deposit.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: true })
      .expect(409);

    await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${deposit.id}`,
      viewerToken,
      acmeId,
    )
      .send({ cleared: false })
      .expect(403);

    const clearAudit = await call(
      'get',
      '/audit-log?action=reconciliation.clear&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      clearAudit.body.entries.some(
        (row: { entityId: string; metadata?: { transactionId?: string } }) =>
          row.entityId === session.id && row.metadata?.transactionId === deposit.id,
      ),
    ).toBe(true);
    const unclearAudit = await call(
      'get',
      '/audit-log?action=reconciliation.unclear&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      unclearAudit.body.entries.some(
        (row: { entityId: string; metadata?: { transactionId?: string } }) =>
          row.entityId === session.id && row.metadata?.transactionId === withdrawal.id,
      ),
    ).toBe(true);
  });

  it('completes only a balanced session, locks it, and undoes the completion', async () => {
    const { session } = await setup();
    const deposit = session.transactions.find((row) => row.amount === 500)!;
    const withdrawal = session.transactions.find((row) => row.amount === -200)!;

    await call('post', `/reconciliations/${session.id}/complete`, staffToken, acmeId).expect(400);

    for (const transaction of [deposit, withdrawal]) {
      await call(
        'patch',
        `/reconciliations/${session.id}/transactions/${transaction.id}`,
        staffToken,
        acmeId,
      )
        .send({ cleared: true })
        .expect(200);
    }

    await call('post', `/reconciliations/${session.id}/complete`, viewerToken, acmeId).expect(403);

    const completed = await call(
      'post',
      `/reconciliations/${session.id}/complete`,
      staffToken,
      acmeId,
    ).expect(200);
    expect(completed.body).toMatchObject({
      id: session.id,
      status: 'COMPLETED',
      difference: 0,
      balanced: true,
      clearedTotal: 300,
      clearedBalance: 1300,
      completedAt: expect.any(String),
    });

    await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${deposit.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: false })
      .expect(409);
    await call('post', `/reconciliations/${session.id}/complete`, staffToken, acmeId).expect(409);
    await call(
      'post',
      `/reconciliations/${session.id}/undo`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(404);
    await call('post', `/reconciliations/${session.id}/undo`, viewerToken, acmeId).expect(403);

    const completeAudit = await call(
      'get',
      '/audit-log?action=reconciliation.complete&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      completeAudit.body.entries.find((row: { entityId: string }) => row.entityId === session.id),
    ).toMatchObject({
      entityType: 'ReconciliationSession',
      action: 'reconciliation.complete',
      metadata: { difference: 0, clearedCount: 2 },
    });

    const undone = await call(
      'post',
      `/reconciliations/${session.id}/undo`,
      staffToken,
      acmeId,
    ).expect(200);
    expect(undone.body).toMatchObject({
      id: session.id,
      status: 'ACTIVE',
      completedAt: null,
      clearedTotal: 300,
      clearedBalance: 1300,
      difference: 0,
      clearedCount: 2,
    });

    await call('post', `/reconciliations/${session.id}/undo`, staffToken, acmeId).expect(409);

    const editableAgain = await call(
      'patch',
      `/reconciliations/${session.id}/transactions/${deposit.id}`,
      staffToken,
      acmeId,
    )
      .send({ cleared: false })
      .expect(200);
    expect(editableAgain.body).toMatchObject({
      clearedTotal: -200,
      clearedBalance: 800,
      difference: 500,
      clearedCount: 1,
    });

    const undoAudit = await call(
      'get',
      '/audit-log?action=reconciliation.undo&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      undoAudit.body.entries.find((row: { entityId: string }) => row.entityId === session.id),
    ).toMatchObject({ entityType: 'ReconciliationSession', action: 'reconciliation.undo' });
  });
});
