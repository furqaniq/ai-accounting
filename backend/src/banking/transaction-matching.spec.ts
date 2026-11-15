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
  matchedEntityType: string | null;
  matchedEntityId: string | null;
  resolutionLabel: string | null;
  resolvedAt: string | null;
}

interface MatchSuggestionView {
  entityType: string;
  entityId: string;
  number: string;
  label: string;
  amount: number;
  date: string;
  score: number;
  rank: number;
  reasons: string[];
}

interface InvoiceView {
  id: string;
  number: string;
  status: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

interface BillView {
  id: string;
  number: string;
  status: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

interface PaymentView {
  id: string;
  number: string;
  amount: number;
  applications: Array<{ invoiceId: string; amount: number }>;
}

interface ExpenseView {
  id: string;
  number: string;
  amount: number;
  memo: string | null;
  version: number;
}

const TEST_PREFIX = 'TEST MATCH';
const ACCOUNT_PREFIX = 'TEST MATCH BANK';
const CSV_HEADERS = 'Date,Description,Amount,Reference';

function csvFile(rows: string, filename = 'test-match.csv') {
  return {
    filename,
    content: `${CSV_HEADERS}\n${rows}`,
    contentType: 'text/csv',
  };
}

describe('Bank transaction matching', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let cashAccountId: string;
  let suppliesAccountId: string;
  let customerId: string;
  let itemId: string;
  let vendorId: string;
  let nimbusInvoiceId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(method: 'get' | 'post', path: string, token: string, orgId: string) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: acmeId, name: { startsWith: ACCOUNT_PREFIX } },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    const transactions = await prisma.bankTransaction.findMany({
      where: { organizationId: acmeId, bankAccountId: { in: accountIds } },
      select: { id: true },
    });
    const transactionIds = transactions.map((transaction) => transaction.id);
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const payments = await prisma.payment.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const paymentIds = payments.map((payment) => payment.id);
    const expenses = await prisma.expense.findMany({
      where: { organizationId: acmeId, memo: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const expenseIds = expenses.map((expense) => expense.id);
    const bills = await prisma.bill.findMany({
      where: { organizationId: acmeId, notes: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const billIds = bills.map((bill) => bill.id);
    const entries = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        OR: [
          { sourceType: 'BANK', sourceId: { in: transactionIds } },
          { sourceType: 'INVOICE', sourceId: { in: invoiceIds } },
          { sourceType: 'PAYMENT', sourceId: { in: paymentIds } },
          { sourceType: 'EXPENSE', sourceId: { in: expenseIds } },
          { sourceType: 'BILL', sourceId: { in: billIds } },
        ],
      },
      select: { id: true },
    });
    const entryIds = entries.map((entry) => entry.id);
    if (entryIds.length > 0) {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    if (transactionIds.length > 0) {
      await prisma.bankTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
    if (accountIds.length > 0) {
      await prisma.bankImportBatch.deleteMany({ where: { bankAccountId: { in: accountIds } } });
      await prisma.bankAccount.deleteMany({ where: { id: { in: accountIds } } });
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
    if (billIds.length > 0) {
      await prisma.bill.deleteMany({ where: { id: { in: billIds } } });
    }
  }

  async function createBankAccount(ledgerAccountId = cashAccountId): Promise<string> {
    const res = await call('post', '/bank-accounts', staffToken, acmeId)
      .send({
        name: `${ACCOUNT_PREFIX} Checking`,
        type: 'CHECKING',
        ledgerAccountId,
      })
      .expect(201);
    return res.body.id;
  }

  async function importTransactions(
    bankAccountId: string,
    rows: string,
  ): Promise<BankTransactionView[]> {
    const file = csvFile(rows);
    const res = await call('post', '/bank-imports', staffToken, acmeId)
      .field('bankAccountId', bankAccountId)
      .attach('file', Buffer.from(file.content), {
        filename: file.filename,
        contentType: file.contentType,
      })
      .expect(201);
    return res.body.transactions as BankTransactionView[];
  }

  async function suggestions(
    transactionId: string,
    token = staffToken,
    orgId = acmeId,
  ): Promise<MatchSuggestionView[]> {
    const res = await call(
      'get',
      `/bank-transactions/${transactionId}/suggestions`,
      token,
      orgId,
    ).expect(200);
    return res.body.suggestions as MatchSuggestionView[];
  }

  async function journalEntriesFor(transactionId: string) {
    const res = await call('get', '/journal-entries?limit=200', ownerToken, acmeId).expect(200);
    return (res.body.entries as Array<{ sourceType: string; sourceId: string | null }>).filter(
      (entry) => entry.sourceType === 'BANK' && entry.sourceId === transactionId,
    );
  }

  async function createSentInvoice(
    amount: number,
    dueDate: string,
    notes: string,
  ): Promise<InvoiceView> {
    const created = await call('post', '/invoices', staffToken, acmeId)
      .send({
        customerId,
        issueDate: '2026-11-20',
        dueDate,
        taxRate: 0,
        notes,
        lines: [{ itemId, quantity: 1, unitPrice: amount }],
      })
      .expect(201);
    await call('post', `/invoices/${created.body.id}/send`, staffToken, acmeId).expect(201);
    return created.body as InvoiceView;
  }

  async function createOpenBill(amount: number, dueDate: string): Promise<BillView> {
    const created = await call('post', '/bills', staffToken, acmeId)
      .send({
        vendorId,
        issueDate: '2026-11-20',
        dueDate,
        taxRate: 0,
        notes: `${TEST_PREFIX} bill`,
        lines: [
          {
            description: `${TEST_PREFIX} utilities`,
            expenseAccountId: suppliesAccountId,
            quantity: 1,
            unitPrice: amount,
          },
        ],
      })
      .expect(201);
    await call('post', `/bills/${created.body.id}/open`, staffToken, acmeId).expect(201);
    return created.body as BillView;
  }

  async function createExpense(amount: number, date: string): Promise<ExpenseView> {
    const res = await call('post', '/expenses', staffToken, acmeId)
      .send({
        date,
        amount,
        categoryAccountId: suppliesAccountId,
        memo: `${TEST_PREFIX} office expense`,
      })
      .expect(201);
    return res.body as ExpenseView;
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
    suppliesAccountId = rows.find((account) => account.code === '6200')!.id;

    const customers = await call('get', '/customers', ownerToken, acmeId).expect(200);
    customerId = customers.body.customers.find(
      (customer: { name: string }) => customer.name === 'Northwind Studio',
    ).id;
    const items = await call('get', '/items', ownerToken, acmeId).expect(200);
    itemId = items.body.items.find(
      (item: { name: string }) => item.name === 'Consulting hour',
    ).id;
    const vendors = await call('get', '/vendors', ownerToken, acmeId).expect(200);
    vendorId = vendors.body.vendors.find(
      (vendor: { name: string }) => vendor.name === 'Brightline Utilities',
    ).id;

    const nimbusInvoices = await call('get', '/invoices', nimbusOwnerToken, nimbusId).expect(200);
    nimbusInvoiceId = nimbusInvoices.body.invoices[0].id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('suggests and links invoices, bills, payments, and expenses without posting', async () => {
    const bankAccountId = await createBankAccount();
    const invoice = await createSentInvoice(321, '2026-12-10', `${TEST_PREFIX} invoice`);
    const bill = await createOpenBill(432, '2026-12-11');
    const paymentInvoice = await createSentInvoice(
      543,
      '2026-12-12',
      `${TEST_PREFIX} payment invoice`,
    );
    const paymentRes = await call('post', '/payments', staffToken, acmeId)
      .send({
        customerId,
        date: '2026-12-12',
        amount: 543,
        method: 'BANK_TRANSFER',
        reference: `${TEST_PREFIX} receipt`,
        notes: `${TEST_PREFIX} payment`,
        applications: [{ invoiceId: paymentInvoice.id, amount: 543 }],
      })
      .expect(201);
    const payment = paymentRes.body as PaymentView;
    const expense = await createExpense(654, '2026-12-13');

    const [invoiceTx, billTx, paymentTx, expenseTx] = await importTransactions(
      bankAccountId,
      [
        `2026-12-10,NORTHWIND INVOICE PAYMENT,321.00,TEST-MATCH-1`,
        `2026-12-11,BRIGHTLINE UTILITIES BILL,-432.00,TEST-MATCH-2`,
        `2026-12-12,NORTHWIND CUSTOMER PAYMENT,543.00,TEST-MATCH-3`,
        `2026-12-13,${TEST_PREFIX} OFFICE EXPENSE,-654.00,TEST-MATCH-4`,
      ].join('\n'),
    );

    expect([invoiceTx, billTx, paymentTx, expenseTx].map((row) => row.matchState)).toEqual([
      'UNMATCHED',
      'UNMATCHED',
      'UNMATCHED',
      'UNMATCHED',
    ]);

    const invoiceSuggestions = await suggestions(invoiceTx.id);
    expect(invoiceSuggestions[0]).toMatchObject({
      entityType: 'INVOICE',
      entityId: invoice.id,
      number: invoice.number,
      amount: 321,
      date: '2026-12-10',
      rank: 1,
    });
    expect(invoiceSuggestions[0].label).toContain('Northwind Studio');
    expect(invoiceSuggestions[0].reasons).toEqual(
      expect.arrayContaining(['Amount matches exactly', 'Same day']),
    );
    expect(invoiceSuggestions.map((row) => row.entityId)).not.toContain(nimbusInvoiceId);

    const billSuggestions = await suggestions(billTx.id);
    expect(billSuggestions[0]).toMatchObject({
      entityType: 'BILL',
      entityId: bill.id,
      number: bill.number,
      amount: 432,
      rank: 1,
    });
    const paymentSuggestions = await suggestions(paymentTx.id);
    expect(paymentSuggestions[0]).toMatchObject({
      entityType: 'PAYMENT',
      entityId: payment.id,
      number: payment.number,
      amount: 543,
      rank: 1,
    });
    const expenseSuggestions = await suggestions(expenseTx.id);
    expect(expenseSuggestions[0]).toMatchObject({
      entityType: 'EXPENSE',
      entityId: expense.id,
      number: expense.number,
      amount: 654,
      rank: 1,
    });

    const invoiceBefore = (await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId)
      .expect(200)).body as InvoiceView;
    const billBefore = (await call('get', `/bills/${bill.id}`, viewerToken, acmeId).expect(200))
      .body as BillView;
    const paymentBefore = (await call('get', `/payments/${payment.id}`, viewerToken, acmeId)
      .expect(200)).body as PaymentView;
    const expenseBefore = (await call('get', `/expenses/${expense.id}`, viewerToken, acmeId)
      .expect(200)).body as ExpenseView;

    const matches = [
      { transaction: invoiceTx, type: 'INVOICE', targetId: invoice.id, number: invoice.number },
      { transaction: billTx, type: 'BILL', targetId: bill.id, number: bill.number },
      { transaction: paymentTx, type: 'PAYMENT', targetId: payment.id, number: payment.number },
      { transaction: expenseTx, type: 'EXPENSE', targetId: expense.id, number: expense.number },
    ];

    for (const match of matches) {
      const response = await call(
        'post',
        `/bank-transactions/${match.transaction.id}/match`,
        staffToken,
        acmeId,
      )
        .send({ entityType: match.type, entityId: match.targetId })
        .expect(201);
      expect(response.body).toMatchObject({
        id: match.transaction.id,
        matchState: 'MATCHED',
        matchedEntityType: match.type,
        matchedEntityId: match.targetId,
      });
      expect(response.body.resolutionLabel).toContain(match.number);
      expect(response.body.resolvedAt).toBeTruthy();
      expect(response.body.categoryAccountId).toBeNull();
      expect(await journalEntriesFor(match.transaction.id)).toHaveLength(0);

      await call(
        'post',
        `/bank-transactions/${match.transaction.id}/match`,
        staffToken,
        acmeId,
      )
        .send({ entityType: match.type, entityId: match.targetId })
        .expect(409);
      await call(
        'get',
        `/bank-transactions/${match.transaction.id}/suggestions`,
        staffToken,
        acmeId,
      ).expect(409);
    }

    const invoiceAfter = (await call('get', `/invoices/${invoice.id}`, viewerToken, acmeId)
      .expect(200)).body as InvoiceView;
    expect(invoiceAfter).toMatchObject({
      status: invoiceBefore.status,
      total: invoiceBefore.total,
      amountPaid: invoiceBefore.amountPaid,
      balanceDue: invoiceBefore.balanceDue,
    });
    const billAfter = (await call('get', `/bills/${bill.id}`, viewerToken, acmeId).expect(200))
      .body as BillView;
    expect(billAfter).toMatchObject({
      status: billBefore.status,
      total: billBefore.total,
      amountPaid: billBefore.amountPaid,
      balanceDue: billBefore.balanceDue,
    });
    const paymentAfter = (await call('get', `/payments/${payment.id}`, viewerToken, acmeId)
      .expect(200)).body as PaymentView;
    expect(paymentAfter).toMatchObject({
      amount: paymentBefore.amount,
      applications: paymentBefore.applications,
    });
    const expenseAfter = (await call('get', `/expenses/${expense.id}`, viewerToken, acmeId)
      .expect(200)).body as ExpenseView;
    expect(expenseAfter).toMatchObject({
      amount: expenseBefore.amount,
      memo: expenseBefore.memo,
      version: expenseBefore.version,
    });

    const [wrongDirection] = await importTransactions(
      bankAccountId,
      '2026-12-14,TEST MATCH WRONG DIRECTION,-321.00,TEST-MATCH-5\n',
    );
    await call(
      'post',
      `/bank-transactions/${wrongDirection.id}/match`,
      staffToken,
      acmeId,
    )
      .send({ entityType: 'INVOICE', entityId: invoice.id })
      .expect(400);

    const [viewerTransaction] = await importTransactions(
      bankAccountId,
      '2026-12-14,TEST MATCH VIEWER,99.00,TEST-MATCH-6\n',
    );
    await call(
      'get',
      `/bank-transactions/${viewerTransaction.id}/suggestions`,
      viewerToken,
      acmeId,
    ).expect(200);
    await call(
      'post',
      `/bank-transactions/${viewerTransaction.id}/match`,
      viewerToken,
      acmeId,
    )
      .send({ entityType: 'INVOICE', entityId: invoice.id })
      .expect(403);

    const audit = await call(
      'get',
      '/audit-log?action=bank.transaction.match&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === invoiceTx.id),
    ).toMatchObject({
      entityType: 'BankTransaction',
      action: 'bank.transaction.match',
      metadata: { entityType: 'INVOICE', number: invoice.number },
    });
  });

  it('does not suggest or link records from another organization', async () => {
    const bankAccountId = await createBankAccount();
    const [transaction] = await importTransactions(
      bankAccountId,
      '2026-12-10,CEDAR MARKET INVOICE,99.00,TEST-MATCH-TENANT\n',
    );

    const rows = await suggestions(transaction.id);
    expect(rows.map((row) => row.entityId)).not.toContain(nimbusInvoiceId);
    await call('post', `/bank-transactions/${transaction.id}/match`, staffToken, acmeId)
      .send({ entityType: 'INVOICE', entityId: nimbusInvoiceId })
      .expect(404);
    await call(
      'get',
      `/bank-transactions/${transaction.id}/suggestions`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(404);
    await call('post', `/bank-transactions/${transaction.id}/match`, nimbusOwnerToken, nimbusId)
      .send({ entityType: 'INVOICE', entityId: nimbusInvoiceId })
      .expect(404);

    const unchanged = await call(
      'get',
      `/bank-transactions/${transaction.id}`,
      staffToken,
      acmeId,
    ).expect(200);
    expect(unchanged.body).toMatchObject({
      matchState: 'UNMATCHED',
      matchedEntityType: null,
      matchedEntityId: null,
      resolvedAt: null,
    });
  });
});
