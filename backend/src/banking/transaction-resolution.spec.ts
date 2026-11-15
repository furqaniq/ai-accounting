import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface BankTransactionView {
  id: string;
  description: string;
  amount: number;
  matchState: string;
  categoryAccountId: string | null;
  categoryAccount: { id: string; code: string; name: string } | null;
  matchedEntityType: string | null;
  matchedEntityId: string | null;
  resolutionLabel: string | null;
  resolvedAt: string | null;
}

interface JournalEntryView {
  id: string;
  sourceType: string;
  sourceId: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
}

interface InvoiceView {
  id: string;
  number: string;
  total: number;
  status: string;
  balanceDue: number;
}

interface PaymentView {
  id: string;
  number: string;
  amount: number;
  applications: Array<{ invoiceId: string; amount: number }>;
}

const TEST_PREFIX = 'TEST RESOLVE BANK';
const CSV_HEADERS = 'Date,Description,Amount,Reference';

function csvFile(rows: string, filename = 'test-resolve.csv') {
  return {
    filename,
    content: `${CSV_HEADERS}\n${rows}`,
    contentType: 'text/csv',
  };
}

describe('Bank transaction resolution', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let cashAccountId: string;
  let prepaidAccountId: string;
  let suppliesAccountId: string;
  let salesIncomeAccountId: string;
  let arAccountId: string;
  let customerId: string;
  let itemId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    if (accountIds.length > 0) {
      const transactions = await prisma.bankTransaction.findMany({
        where: { bankAccountId: { in: accountIds } },
        select: { id: true, matchedEntityType: true, matchedEntityId: true },
      });
      const transactionIds = transactions.map((transaction) => transaction.id);
      const expenseIds = transactions
        .filter((transaction) => transaction.matchedEntityType === 'EXPENSE')
        .map((transaction) => transaction.matchedEntityId!)
        .filter(Boolean);
      const paymentIds = transactions
        .filter((transaction) => transaction.matchedEntityType === 'PAYMENT')
        .map((transaction) => transaction.matchedEntityId!)
        .filter(Boolean);
      const invoices = await prisma.invoice.findMany({
        where: { organizationId: acmeId, notes: { startsWith: 'TEST RESOLVE' } },
        select: { id: true },
      });
      const invoiceIds = invoices.map((invoice) => invoice.id);
      const entries =
        transactionIds.length > 0 ||
        expenseIds.length > 0 ||
        paymentIds.length > 0 ||
        invoiceIds.length > 0
          ? await prisma.journalEntry.findMany({
              where: {
                OR: [
                  { sourceType: 'BANK', sourceId: { in: transactionIds } },
                  { sourceType: 'EXPENSE', sourceId: { in: expenseIds } },
                  { sourceType: 'PAYMENT', sourceId: { in: paymentIds } },
                  { sourceType: 'INVOICE', sourceId: { in: invoiceIds } },
                ],
              },
              select: { id: true },
            })
          : [];
      const entryIds = entries.map((entry) => entry.id);
      if (entryIds.length > 0) {
        await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
      }
      if (paymentIds.length > 0) {
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      if (expenseIds.length > 0) {
        await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
      }
      if (invoiceIds.length > 0) {
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await prisma.bankTransaction.deleteMany({ where: { bankAccountId: { in: accountIds } } });
      await prisma.bankImportBatch.deleteMany({ where: { bankAccountId: { in: accountIds } } });
      await prisma.bankAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
  }

  async function createBankAccount(
    name = `${TEST_PREFIX} Checking`,
    ledgerAccountId = cashAccountId,
  ): Promise<string> {
    const res = await call('post', '/bank-accounts', staffToken, acmeId)
      .send({ name, type: 'CHECKING', ledgerAccountId })
      .expect(201);
    return res.body.id;
  }

  function importCsv(bankAccountId: string, file = csvFile('')) {
    return call('post', '/bank-imports', staffToken, acmeId)
      .field('bankAccountId', bankAccountId)
      .attach('file', Buffer.from(file.content), {
        filename: file.filename,
        contentType: file.contentType,
      });
  }

  async function importTransactions(
    bankAccountId: string,
    rows: string,
  ): Promise<BankTransactionView[]> {
    const res = await importCsv(bankAccountId, csvFile(rows)).expect(201);
    return res.body.transactions as BankTransactionView[];
  }

  async function journalEntriesFor(transactionId: string): Promise<JournalEntryView[]> {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as JournalEntryView[]).filter(
      (entry) => entry.sourceType === 'BANK' && entry.sourceId === transactionId,
    );
  }

  async function journalEntryForExpense(expenseId: string): Promise<JournalEntryView[]> {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as JournalEntryView[]).filter(
      (entry) => entry.sourceType === 'EXPENSE' && entry.sourceId === expenseId,
    );
  }

  async function journalEntryForPayment(paymentId: string): Promise<JournalEntryView[]> {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as JournalEntryView[]).filter(
      (entry) => entry.sourceType === 'PAYMENT' && entry.sourceId === paymentId,
    );
  }

  async function createSentInvoice(): Promise<InvoiceView> {
    const created = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-10-13',
        dueDate: '2026-12-13',
        taxRate: 0,
        notes: 'TEST RESOLVE invoice',
        lines: [{ itemId, quantity: 1, unitPrice: 1000 }],
      })
      .expect(201);
    await call('post', `/invoices/${created.body.id}/send`, staffToken, acmeId).expect(201);
    return created.body as InvoiceView;
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
    const rows = accounts.body.accounts as Array<{ id: string; code: string }>;
    cashAccountId = rows.find((account) => account.code === '1000')!.id;
    prepaidAccountId = rows.find((account) => account.code === '1200')!.id;
    suppliesAccountId = rows.find((account) => account.code === '6200')!.id;
    salesIncomeAccountId = rows.find((account) => account.code === '4000')!.id;
    arAccountId = rows.find((account) => account.code === '1100')!.id;

    const customers = await call('get', '/customers', ownerToken, acmeId).expect(200);
    customerId = customers.body.customers[0].id;
    const items = await call('get', '/items', ownerToken, acmeId).expect(200);
    itemId = items.body.items[0].id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });


  it('transfers value between linked bank accounts and posts the other side', async () => {
    const sourceId = await createBankAccount();
    const targetId = await createBankAccount(`${TEST_PREFIX} Savings`, prepaidAccountId);
    const [transaction] = await importTransactions(
      sourceId,
      '2026-10-11,TEST RESOLVE TRANSFER,-75.00,TEST-RESOLVE-2\n',
    );

    const resolved = await call(
      'post',
      `/bank-transactions/${transaction.id}/transfer`,
      staffToken,
      acmeId,
    )
      .send({ bankAccountId: targetId })
      .expect(201);

    expect(resolved.body).toMatchObject({
      id: transaction.id,
      matchState: 'MATCHED',
      categoryAccountId: prepaidAccountId,
      categoryAccount: { code: '1200', name: 'Prepaid expenses' },
      matchedEntityType: 'BANK_ACCOUNT',
      matchedEntityId: targetId,
      resolutionLabel: `Transfer to ${TEST_PREFIX} Savings`,
    });

    const journals = await journalEntriesFor(transaction.id);
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: prepaidAccountId, debit: 75, credit: 0 }),
        expect.objectContaining({ accountId: cashAccountId, debit: 0, credit: 75 }),
      ]),
    );

    await call(
      'post',
      `/bank-transactions/${transaction.id}/transfer`,
      staffToken,
      acmeId,
    )
      .send({ bankAccountId: sourceId })
      .expect(409);

    const [second] = await importTransactions(
      sourceId,
      '2026-10-12,TEST RESOLVE SELF,-5.00,TEST-RESOLVE-3\n',
    );
    await call('post', `/bank-transactions/${second.id}/transfer`, staffToken, acmeId)
      .send({ bankAccountId: sourceId })
      .expect(400);

    const audit = await call(
      'get',
      '/audit-log?action=bank.transaction.transfer&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === transaction.id),
    ).toMatchObject({
      entityType: 'BankTransaction',
      action: 'bank.transaction.transfer',
      metadata: { targetBankAccount: `${TEST_PREFIX} Savings` },
    });
  });


  it('creates and posts an expense from an outflow transaction', async () => {
    const bankAccountId = await createBankAccount();
    const [transaction] = await importTransactions(
      bankAccountId,
      '2026-10-13,TEST RESOLVE OFFICE CHAIRS,-125.00,TEST-RESOLVE-4\n',
    );

    const resolved = await call(
      'post',
      `/bank-transactions/${transaction.id}/expense`,
      staffToken,
      acmeId,
    )
      .send({ categoryAccountId: suppliesAccountId })
      .expect(201);

    expect(resolved.body).toMatchObject({
      id: transaction.id,
      matchState: 'MATCHED',
      categoryAccountId: suppliesAccountId,
      categoryAccount: { code: '6200', name: 'Supplies expense' },
      matchedEntityType: 'EXPENSE',
    });
    expect(resolved.body.matchedEntityId).toBeTruthy();
    expect(resolved.body.resolutionLabel).toMatch(/^EXP-\d{4}$/);

    const expense = await call(
      'get',
      `/expenses/${resolved.body.matchedEntityId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(expense.body).toMatchObject({
      date: '2026-10-13',
      amount: 125,
      memo: 'TEST RESOLVE OFFICE CHAIRS',
      categoryAccount: { code: '6200' },
    });

    const journals = await journalEntryForExpense(resolved.body.matchedEntityId);
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: suppliesAccountId, debit: 125, credit: 0 }),
        expect.objectContaining({ accountId: cashAccountId, debit: 0, credit: 125 }),
      ]),
    );

    await call('post', `/bank-transactions/${transaction.id}/expense`, staffToken, acmeId)
      .send({ categoryAccountId: suppliesAccountId })
      .expect(409);

    const [inflow] = await importTransactions(
      bankAccountId,
      '2026-10-14,TEST RESOLVE INFLOW EXPENSE,10.00,TEST-RESOLVE-5\n',
    );
    await call('post', `/bank-transactions/${inflow.id}/expense`, staffToken, acmeId)
      .send({ categoryAccountId: suppliesAccountId })
      .expect(400);

    const audit = await call(
      'get',
      '/audit-log?action=bank.transaction.expense&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === transaction.id),
    ).toMatchObject({
      entityType: 'BankTransaction',
      action: 'bank.transaction.expense',
      metadata: { number: resolved.body.resolutionLabel },
    });
  });


  it('records a customer payment from an inflow transaction against an open invoice', async () => {
    const bankAccountId = await createBankAccount();
    const invoice = await createSentInvoice();
    const [transaction] = await importTransactions(
      bankAccountId,
      '2026-10-15,TEST RESOLVE CUSTOMER PAYMENT,250.00,TEST-RESOLVE-6\n',
    );

    const resolved = await call(
      'post',
      `/bank-transactions/${transaction.id}/payment`,
      staffToken,
      acmeId,
    )
      .send({
        customerId,
        reference: 'TEST RESOLVE transfer',
        applications: [{ invoiceId: invoice.id, amount: 250 }],
      })
      .expect(201);

    expect(resolved.body).toMatchObject({
      id: transaction.id,
      matchState: 'MATCHED',
      categoryAccountId: null,
      matchedEntityType: 'PAYMENT',
    });
    expect(resolved.body.matchedEntityId).toBeTruthy();
    expect(resolved.body.resolutionLabel).toMatch(/^PAY-\d{4}$/);

    const payment = await call(
      'get',
      `/payments/${resolved.body.matchedEntityId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(payment.body).toMatchObject({
      amount: 250,
      customerId,
      applications: [{ invoiceId: invoice.id, amount: 250 }],
    });

    const invoiceAfter = await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId).expect(200);
    expect(invoiceAfter.body).toMatchObject({
      status: 'PARTIAL',
      amountPaid: 250,
      balanceDue: 750,
    });

    const journals = await journalEntryForPayment(resolved.body.matchedEntityId);
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: cashAccountId, debit: 250, credit: 0 }),
        expect.objectContaining({ accountId: arAccountId, debit: 0, credit: 250 }),
      ]),
    );

    await call('post', `/bank-transactions/${transaction.id}/payment`, staffToken, acmeId)
      .send({ customerId, applications: [{ invoiceId: invoice.id, amount: 250 }] })
      .expect(409);

    const [outflow] = await importTransactions(
      bankAccountId,
      '2026-10-16,TEST RESOLVE OUTFLOW PAYMENT,-10.00,TEST-RESOLVE-7\n',
    );
    await call('post', `/bank-transactions/${outflow.id}/payment`, staffToken, acmeId)
      .send({ customerId, applications: [{ invoiceId: invoice.id, amount: 10 }] })
      .expect(400);

    const audit = await call(
      'get',
      '/audit-log?action=bank.transaction.payment&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === transaction.id),
    ).toMatchObject({
      entityType: 'BankTransaction',
      action: 'bank.transaction.payment',
      metadata: { number: resolved.body.resolutionLabel },
    });
  });

  it('categorizes an unmatched transaction directly and posts one balanced BANK journal', async () => {
    const bankAccountId = await createBankAccount();
    const [transaction] = await importTransactions(
      bankAccountId,
      '2026-10-10,TEST RESOLVE INFLOW,40.00,TEST-RESOLVE-1\n',
    );

    const resolved = await call(
      'post',
      `/bank-transactions/${transaction.id}/categorize`,
      staffToken,
      acmeId,
    )
      .send({ accountId: salesIncomeAccountId })
      .expect(201);

    expect(resolved.body).toMatchObject({
      id: transaction.id,
      matchState: 'CATEGORIZED',
      categoryAccountId: salesIncomeAccountId,
      categoryAccount: { code: '4000', name: 'Sales income' },
      matchedEntityType: 'ACCOUNT',
      matchedEntityId: salesIncomeAccountId,
      resolutionLabel: '4000 Sales income',
    });
    expect(resolved.body.resolvedAt).not.toBeNull();

    const journals = await journalEntriesFor(transaction.id);
    expect(journals).toHaveLength(1);
    expect(journals[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: cashAccountId, debit: 40, credit: 0 }),
        expect.objectContaining({ accountId: salesIncomeAccountId, debit: 0, credit: 40 }),
      ]),
    );

    await call(
      'post',
      `/bank-transactions/${transaction.id}/categorize`,
      staffToken,
      acmeId,
    )
      .send({ accountId: suppliesAccountId })
      .expect(409);

    await call(
      'post',
      `/bank-transactions/${transaction.id}/categorize`,
      viewerToken,
      acmeId,
    )
      .send({ accountId: suppliesAccountId })
      .expect(403);

    const audit = await call(
      'get',
      '/audit-log?action=bank.transaction.categorize&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === transaction.id),
    ).toMatchObject({
      entityType: 'BankTransaction',
      action: 'bank.transaction.categorize',
      metadata: { account: '4000 Sales income' },
    });

    await call(
      'post',
      `/bank-transactions/${transaction.id}/categorize`,
      nimbusOwnerToken,
      nimbusId,
    )
      .send({ accountId: salesIncomeAccountId })
      .expect(404);
  });

  it('guards every resolution path with permission and tenant checks', async () => {
    const bankAccountId = await createBankAccount();
    const [transaction] = await importTransactions(
      bankAccountId,
      '2026-10-17,TEST RESOLVE GUARDED,20.00,TEST-RESOLVE-8\n',
    );
    const payloads = {
      categorize: { accountId: salesIncomeAccountId },
      transfer: { bankAccountId },
      expense: { categoryAccountId: suppliesAccountId },
      payment: {
        customerId,
        applications: [{ invoiceId: 'missing-invoice', amount: 20 }],
      },
    };

    for (const [path, payload] of Object.entries(payloads)) {
      await call(
        'post',
        `/bank-transactions/${transaction.id}/${path}`,
        viewerToken,
        acmeId,
      )
        .send(payload)
        .expect(403);
      await call(
        'post',
        `/bank-transactions/${transaction.id}/${path}`,
        nimbusOwnerToken,
        nimbusId,
      )
        .send(payload)
        .expect(404);
    }
  });
});
