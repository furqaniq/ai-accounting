import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface BankAccountView {
  id: string;
  name: string;
  type: string;
  ledgerAccountId: string;
  ledgerAccount: { code: string; name: string; type: string };
  transactionCount: number;
}

interface BankTransactionView {
  id: string;
  bankAccountId: string;
  importBatchId: string;
  importBatch: { filename: string; format: string };
  date: string;
  description: string;
  amount: number;
  externalId: string | null;
  matchState: string;
}

const TEST_PREFIX = 'TEST BANK';
const CSV_HEADERS = 'When,What,Value,Ref';
const CSV_ROWS =
  `2026-10-01,INVOICE PAYMENT NORTHWIND,1200.00,TEST-BANK-1\r\n` +
  `2026-10-03,"OFFICE SUPPLIES, DEPOT",-84.25,TEST-BANK-2\r\n` +
  `2026-10-05,CLIENT RETAINER HARBOR,2500.00,TEST-BANK-3\r\n`;

const MAPPING = {
  dateColumn: 'When',
  descriptionColumn: 'What',
  amountColumn: 'Value',
  externalIdColumn: 'Ref',
};

function csvFile(content = `${CSV_HEADERS}\n${CSV_ROWS}`) {
  return { filename: 'test-bank-activity.csv', content, contentType: 'text/csv' };
}

describe('Banking', () => {
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
  let payableAccountId: string;

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
    const ids = accounts.map((account) => account.id);
    if (ids.length === 0) return;
    await prisma.bankTransaction.deleteMany({ where: { bankAccountId: { in: ids } } });
    await prisma.bankImportBatch.deleteMany({ where: { bankAccountId: { in: ids } } });
    await prisma.bankAccount.deleteMany({ where: { id: { in: ids } } });
  }

  async function createAccount(
    name = `${TEST_PREFIX} Checking`,
    type = 'CHECKING',
    ledgerAccountId = cashAccountId,
  ): Promise<BankAccountView> {
    const res = await call('post', '/bank-accounts', staffToken, acmeId)
      .send({ name, type, ledgerAccountId })
      .expect(201);
    return res.body as BankAccountView;
  }

  function addMapping(req: request.Test, mapping: Record<string, string>) {
    for (const [field, value] of Object.entries(mapping)) {
      req.field(field, value);
    }
    return req;
  }

  function preview(
    accountId: string,
    file = csvFile(),
    mapping: Record<string, string> = {},
  ) {
    return addMapping(
      call('post', '/bank-imports/preview', staffToken, acmeId)
        .field('bankAccountId', accountId),
      mapping,
    ).attach('file', Buffer.from(file.content), {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  function confirm(
    accountId: string,
    file = csvFile(),
    mapping: Record<string, string> = {},
  ) {
    return addMapping(
      call('post', '/bank-imports', staffToken, acmeId)
        .field('bankAccountId', accountId),
      mapping,
    ).attach('file', Buffer.from(file.content), {
      filename: file.filename,
      contentType: file.contentType,
    });
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
    payableAccountId = rows.find((account) => account.code === '2000')!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates bank and card accounts linked to the right ledger accounts', async () => {
    const checking = await createAccount();
    expect(checking).toMatchObject({
      name: `${TEST_PREFIX} Checking`,
      type: 'CHECKING',
      ledgerAccountId: cashAccountId,
      transactionCount: 0,
    });
    expect(checking.ledgerAccount).toMatchObject({ code: '1000', type: 'ASSET' });

    const card = await createAccount(`${TEST_PREFIX} Card`, 'CREDIT_CARD', payableAccountId);
    expect(card).toMatchObject({ type: 'CREDIT_CARD', ledgerAccountId: payableAccountId });
    expect(card.ledgerAccount).toMatchObject({ code: '2000', type: 'LIABILITY' });

    const list = await call('get', '/bank-accounts', viewerToken, acmeId).expect(200);
    expect(
      list.body.bankAccounts.some((row: BankAccountView) => row.id === checking.id),
    ).toBe(true);

    await call('post', '/bank-accounts', staffToken, acmeId)
      .send({
        name: `${TEST_PREFIX} Duplicate`,
        type: 'CHECKING',
        ledgerAccountId: cashAccountId,
      })
      .expect(409);
    await call('post', '/bank-accounts', staffToken, acmeId)
      .send({
        name: `${TEST_PREFIX} Bad card`,
        type: 'CREDIT_CARD',
        ledgerAccountId: cashAccountId,
      })
      .expect(400);
    await call('post', '/bank-accounts', staffToken, acmeId)
      .send({
        name: `${TEST_PREFIX} Bad bank`,
        type: 'CHECKING',
        ledgerAccountId: payableAccountId,
      })
      .expect(400);
    await call('post', '/bank-accounts', viewerToken, acmeId)
      .send({ name: `${TEST_PREFIX} Viewer`, type: 'CHECKING', ledgerAccountId: cashAccountId })
      .expect(403);
    await call('post', '/bank-accounts', nimbusOwnerToken, nimbusId)
      .send({ name: `${TEST_PREFIX} Foreign`, type: 'CHECKING', ledgerAccountId: cashAccountId })
      .expect(404);

    const audit = await call(
      'get',
      '/audit-log?action=bank.account.create&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === checking.id),
    ).toMatchObject({
      entityType: 'BankAccount',
      action: 'bank.account.create',
      metadata: { name: `${TEST_PREFIX} Checking`, type: 'CHECKING' },
    });
  });

  it('previews mapped CSV rows, imports them once, filters them, and skips duplicates', async () => {
    const account = await createAccount();

    const unmapped = await preview(account.id).expect(200);
    expect(unmapped.body).toMatchObject({
      format: 'CSV',
      headers: ['When', 'What', 'Value', 'Ref'],
      mappingError: 'Choose the date column.',
    });
    expect(unmapped.body.mapping).toMatchObject({ amount: 'Value', externalId: 'Ref' });

    const mapped = await preview(account.id, csvFile(), MAPPING).expect(200);
    expect(mapped.body).toMatchObject({
      filename: 'test-bank-activity.csv',
      format: 'CSV',
      mappingError: null,
      counts: { total: 3, valid: 3, invalid: 0, duplicate: 0, newCount: 3 },
    });
    expect(mapped.body.rows[0]).toMatchObject({
      date: '2026-10-01',
      description: 'INVOICE PAYMENT NORTHWIND',
      amount: 1200,
      valid: true,
      duplicate: false,
    });
    expect(mapped.body.rows[1]).toMatchObject({
      description: 'OFFICE SUPPLIES, DEPOT',
      amount: -84.25,
    });

    const imported = await confirm(account.id, csvFile(), MAPPING).expect(201);
    expect(imported.body.batch).toMatchObject({
      filename: 'test-bank-activity.csv',
      format: 'CSV',
      rowCount: 3,
      importedCount: 3,
      duplicateCount: 0,
      invalidCount: 0,
    });
    expect(imported.body.transactions).toHaveLength(3);

    const list = await call(
      'get',
      `/bank-transactions?bankAccountId=${account.id}&matchState=UNMATCHED`,
      viewerToken,
      acmeId,
    ).expect(200);
    const transactions = list.body.transactions as BankTransactionView[];
    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toMatchObject({
      bankAccountId: account.id,
      date: '2026-10-05',
      description: 'CLIENT RETAINER HARBOR',
      amount: 2500,
      externalId: 'TEST-BANK-3',
      matchState: 'UNMATCHED',
      importBatch: { filename: 'test-bank-activity.csv', format: 'CSV' },
    });

    const search = await call(
      'get',
      `/bank-transactions?bankAccountId=${account.id}&search=NORTHWIND&from=2026-10-01&to=2026-10-02`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(search.body.transactions).toHaveLength(1);
    expect(search.body.transactions[0].externalId).toBe('TEST-BANK-1');

    const duplicate = await confirm(account.id, csvFile(), MAPPING).expect(201);
    expect(duplicate.body.batch).toMatchObject({
      rowCount: 3,
      importedCount: 0,
      duplicateCount: 3,
      invalidCount: 0,
    });
    expect(duplicate.body.transactions).toHaveLength(0);

    const after = await call(
      'get',
      `/bank-transactions?bankAccountId=${account.id}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(after.body.transactions).toHaveLength(3);

    const audit = await call(
      'get',
      '/audit-log?action=bank.import&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find(
        (row: { entityId: string }) => row.entityId === imported.body.batch.id,
      ),
    ).toMatchObject({
      entityType: 'BankImportBatch',
      action: 'bank.import',
      metadata: { filename: 'test-bank-activity.csv', importedCount: 3 },
    });

    await call('post', '/bank-imports', viewerToken, acmeId)
      .field('bankAccountId', account.id)
      .attach('file', Buffer.from(`${CSV_HEADERS}\n${CSV_ROWS}`), {
        filename: 'viewer.csv',
        contentType: 'text/csv',
      })
      .expect(403);
  });

  it('imports OFX and separate debit/credit CSV columns, counting invalid rows', async () => {
    const account = await createAccount(`${TEST_PREFIX} OFX`);

    const ofx =
      `OFXHEADER:100\n` +
      `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n` +
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001120000[-5:EST]<TRNAMT>-84.25` +
      `<FITID>TEST-OFX-1<NAME>OFFICE SUPPLIES<MEMO>Paper</STMTTRN>\n` +
      `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261003<TRNAMT>1200.00` +
      `<FITID>TEST-OFX-2<NAME>INVOICE PAYMENT</STMTTRN>\n` +
      `</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`;
    const ofxFile = { filename: 'test-bank-activity.ofx', content: ofx, contentType: 'application/ofx' };

    const ofxPreview = await preview(account.id, ofxFile).expect(200);
    expect(ofxPreview.body).toMatchObject({
      format: 'OFX',
      headers: [],
      mapping: null,
      mappingError: null,
      counts: { total: 2, valid: 2, invalid: 0, duplicate: 0, newCount: 2 },
    });
    const ofxImport = await confirm(account.id, ofxFile).expect(201);
    expect(ofxImport.body.batch.importedCount).toBe(2);
    expect(ofxImport.body.transactions[0]).toMatchObject({
      description: 'OFFICE SUPPLIES — Paper',
      amount: -84.25,
      externalId: 'TEST-OFX-1',
    });

    const csv =
      `Date,Description,Debit,Credit\n` +
      `2026-10-07,Check 1042,100.00,\n` +
      `2026-10-08,Customer payment,,250.50\n` +
      `2026-02-30,Bad date,10.00,\n`;
    const debitCreditFile = {
      filename: 'test-bank-debit-credit.csv',
      content: csv,
      contentType: 'text/csv',
    };
    const csvPreview = await preview(account.id, debitCreditFile).expect(200);
    expect(csvPreview.body.counts).toMatchObject({ valid: 2, invalid: 1, newCount: 2 });
    const csvImport = await confirm(account.id, debitCreditFile).expect(201);
    expect(csvImport.body.batch).toMatchObject({ importedCount: 2, invalidCount: 1 });

    const list = await call(
      'get',
      `/bank-transactions?bankAccountId=${account.id}`,
      viewerToken,
      acmeId,
    ).expect(200);
    const rows = list.body.transactions as BankTransactionView[];
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.description === 'Check 1042')?.amount).toBe(-100);
    expect(rows.find((row) => row.description === 'Customer payment')?.amount).toBe(250.5);
  });

  it('isolates bank accounts, imports, and transactions across tenants', async () => {
    const account = await createAccount(`${TEST_PREFIX} Isolation`);
    await confirm(account.id, csvFile(), MAPPING).expect(201);

    const foreignList = await call(
      'get',
      `/bank-transactions?bankAccountId=${account.id}`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(200);
    expect(foreignList.body.transactions).toEqual([]);

    await call('post', '/bank-imports/preview', nimbusOwnerToken, nimbusId)
      .field('bankAccountId', account.id)
      .attach('file', Buffer.from(`${CSV_HEADERS}\n${CSV_ROWS}`), {
        filename: 'foreign.csv',
        contentType: 'text/csv',
      })
      .expect(404);
    await call('post', '/bank-imports', nimbusOwnerToken, nimbusId)
      .field('bankAccountId', account.id)
      .attach('file', Buffer.from(`${CSV_HEADERS}\n${CSV_ROWS}`), {
        filename: 'foreign.csv',
        contentType: 'text/csv',
      })
      .expect(404);

    const accounts = await call('get', '/bank-accounts', nimbusOwnerToken, nimbusId).expect(200);
    expect(
      accounts.body.bankAccounts.some((row: BankAccountView) => row.id === account.id),
    ).toBe(false);
  });
});
