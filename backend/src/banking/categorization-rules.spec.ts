import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface RuleView {
  id: string;
  descriptionContains: string;
  targetAccountId: string;
  targetAccount: { id: string; code: string; name: string };
  priority: number;
  active: boolean;
}

interface BankTransactionView {
  id: string;
  description: string;
  amount: number;
  matchState: string;
  categoryAccountId: string | null;
  categoryAccount: { id: string; code: string; name: string } | null;
  categoryRuleId: string | null;
  categoryRule: { id: string; descriptionContains: string } | null;
}

interface JournalEntryView {
  id: string;
  sourceType: string;
  sourceId: string | null;
  lines: Array<{
    accountId: string;
    account: { code: string };
    debit: number;
    credit: number;
  }>;
}

const TEST_PREFIX = 'TEST RULE BANK';
const RULE_PREFIX = 'TEST RULE';
const CSV_HEADERS = 'When,What,Value,Ref';
const CSV_ROWS =
  `2026-10-01,${RULE_PREFIX} FUEL STOP 882,-64.20,${RULE_PREFIX}-TXN-1\r\n` +
  `2026-10-02,MONTHLY ${RULE_PREFIX} FUEL CHARGE,-18.00,${RULE_PREFIX}-TXN-2\r\n` +
  `2026-10-03,CUSTOMER ${RULE_PREFIX} DEPOSIT,1200.00,${RULE_PREFIX}-TXN-3\r\n`;
const MAPPING = {
  dateColumn: 'When',
  descriptionColumn: 'What',
  amountColumn: 'Value',
  externalIdColumn: 'Ref',
};

function csvFile(content = `${CSV_HEADERS}\n${CSV_ROWS}`, filename = 'test-rule-activity.csv') {
  return { filename, content, contentType: 'text/csv' };
}

describe('Categorization rules', () => {
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
  let professionalAccountId: string;
  let bankFeesAccountId: string;
  let salesIncomeAccountId: string;
  let nimbusAccountId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string, orgId: string) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    const accounts = await prisma.bankAccount.findMany({
      where: {
        OR: [
          { organizationId: acmeId, name: { startsWith: TEST_PREFIX } },
          { organizationId: nimbusId, name: { startsWith: TEST_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    if (accountIds.length > 0) {
      const transactions = await prisma.bankTransaction.findMany({
        where: { bankAccountId: { in: accountIds } },
        select: { id: true },
      });
      const transactionIds = transactions.map((transaction) => transaction.id);
      if (transactionIds.length > 0) {
        const entries = await prisma.journalEntry.findMany({
          where: { sourceType: 'BANK', sourceId: { in: transactionIds } },
          select: { id: true },
        });
        const entryIds = entries.map((entry) => entry.id);
        if (entryIds.length > 0) {
          await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
          await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
        }
      }
      await prisma.bankTransaction.deleteMany({ where: { bankAccountId: { in: accountIds } } });
      await prisma.bankImportBatch.deleteMany({ where: { bankAccountId: { in: accountIds } } });
      await prisma.bankAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
    await prisma.categorizationRule.deleteMany({
      where: {
        OR: [
          { organizationId: acmeId, descriptionContains: { startsWith: RULE_PREFIX } },
          { organizationId: nimbusId, descriptionContains: { startsWith: RULE_PREFIX } },
        ],
      },
    });
  }

  async function createRule(
    descriptionContains = `${RULE_PREFIX} FUEL`,
    targetAccountId = bankFeesAccountId,
    priority = 100,
    active = true,
  ): Promise<RuleView> {
    const res = await call('post', '/categorization-rules', staffToken, acmeId)
      .send({ descriptionContains, targetAccountId, priority, active })
      .expect(201);
    return res.body as RuleView;
  }

  async function createBankAccount(name = `${TEST_PREFIX} Checking`): Promise<string> {
    const res = await call('post', '/bank-accounts', staffToken, acmeId)
      .send({ name, type: 'CHECKING', ledgerAccountId: cashAccountId })
      .expect(201);
    return res.body.id;
  }

  function addMapping(req: request.Test, mapping: Record<string, string>) {
    for (const [field, value] of Object.entries(mapping)) {
      req.field(field, value);
    }
    return req;
  }

  function preview(accountId: string, file = csvFile(), mapping: Record<string, string> = MAPPING) {
    return addMapping(
      call('post', '/bank-imports/preview', staffToken, acmeId).field(
        'bankAccountId',
        accountId,
      ),
      mapping,
    ).attach('file', Buffer.from(file.content), {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  function confirm(accountId: string, file = csvFile(), mapping: Record<string, string> = MAPPING) {
    return addMapping(
      call('post', '/bank-imports', staffToken, acmeId).field('bankAccountId', accountId),
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
    suppliesAccountId = rows.find((account) => account.code === '6200')!.id;
    professionalAccountId = rows.find((account) => account.code === '6300')!.id;
    bankFeesAccountId = rows.find((account) => account.code === '6400')!.id;
    salesIncomeAccountId = rows.find((account) => account.code === '4000')!.id;

    const nimbusAccounts = await call('get', '/accounts', nimbusOwnerToken, nimbusId).expect(200);
    nimbusAccountId = (nimbusAccounts.body.accounts as Array<{ id: string; code: string }>).find(
      (account) => account.code === '6400',
    )!.id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('creates, edits, pauses, lists, and deletes org-scoped rules with audit and RBAC', async () => {
    const created = await createRule(`${RULE_PREFIX} FUEL`, bankFeesAccountId, 20);
    expect(created).toMatchObject({
      descriptionContains: `${RULE_PREFIX} FUEL`,
      targetAccountId: bankFeesAccountId,
      priority: 20,
      active: true,
      targetAccount: { code: '6400', name: 'Bank fees' },
    });

    const viewerList = await call('get', '/categorization-rules', viewerToken, acmeId).expect(200);
    expect(
      viewerList.body.rules.find((rule: RuleView) => rule.id === created.id),
    ).toMatchObject({
      descriptionContains: `${RULE_PREFIX} FUEL`,
      targetAccount: { code: '6400' },
    });

    const edited = await call(
      'patch',
      `/categorization-rules/${created.id}`,
      staffToken,
      acmeId,
    )
      .send({
        descriptionContains: `${RULE_PREFIX} PROFESSIONAL`,
        targetAccountId: professionalAccountId,
        priority: 10,
        active: false,
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      descriptionContains: `${RULE_PREFIX} PROFESSIONAL`,
      targetAccountId: professionalAccountId,
      priority: 10,
      active: false,
      targetAccount: { code: '6300', name: 'Professional fees' },
    });

    await call('post', '/categorization-rules', viewerToken, acmeId)
      .send({
        descriptionContains: `${RULE_PREFIX} VIEWER`,
        targetAccountId: suppliesAccountId,
      })
      .expect(403);
    await call('patch', `/categorization-rules/${created.id}`, viewerToken, acmeId)
      .send({ active: true })
      .expect(403);
    await call('delete', `/categorization-rules/${created.id}`, viewerToken, acmeId).expect(403);

    await call('post', '/categorization-rules', nimbusOwnerToken, nimbusId)
      .send({
        descriptionContains: `${RULE_PREFIX} FOREIGN`,
        targetAccountId: bankFeesAccountId,
      })
      .expect(404);

    const nimbusRule = await call('post', '/categorization-rules', nimbusOwnerToken, nimbusId)
      .send({
        descriptionContains: `${RULE_PREFIX} NIMBUS`,
        targetAccountId: nimbusAccountId,
      })
      .expect(201);
    const acmeList = await call('get', '/categorization-rules', ownerToken, acmeId).expect(200);
    expect(
      acmeList.body.rules.some((rule: RuleView) => rule.id === nimbusRule.body.id),
    ).toBe(false);
    await call('patch', `/categorization-rules/${nimbusRule.body.id}`, ownerToken, acmeId)
      .send({ active: false })
      .expect(404);

    await call('delete', `/categorization-rules/${created.id}`, staffToken, acmeId).expect(200);
    const afterDelete = await call('get', '/categorization-rules', ownerToken, acmeId).expect(200);
    expect(afterDelete.body.rules.some((rule: RuleView) => rule.id === created.id)).toBe(false);

    const audit = await call(
      'get',
      '/audit-log?action=bank.rule.create&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === created.id),
    ).toMatchObject({
      entityType: 'CategorizationRule',
      action: 'bank.rule.create',
      metadata: { descriptionContains: `${RULE_PREFIX} FUEL` },
    });
    const updateAudit = await call(
      'get',
      '/audit-log?action=bank.rule.update&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      updateAudit.body.entries.find((row: { entityId: string }) => row.entityId === created.id),
    ).toMatchObject({
      entityType: 'CategorizationRule',
      action: 'bank.rule.update',
    });
    const deleteAudit = await call(
      'get',
      '/audit-log?action=bank.rule.delete&limit=20',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      deleteAudit.body.entries.find((row: { entityId: string }) => row.entityId === created.id),
    ).toMatchObject({
      entityType: 'CategorizationRule',
      action: 'bank.rule.delete',
    });
  });

  it('previews rule effects, applies them once on import, and posts balanced bank journals', async () => {
    const broad = await createRule(`${RULE_PREFIX} FUEL`, bankFeesAccountId, 200);
    const specific = await createRule(`${RULE_PREFIX} FUEL STOP`, professionalAccountId, 50);
    const deposit = await createRule(`${RULE_PREFIX} DEPOSIT`, salesIncomeAccountId, 1);
    const accountId = await createBankAccount();

    const previewRes = await preview(accountId).expect(200);
    expect(previewRes.body.mappingError).toBeNull();
    expect(previewRes.body.counts).toMatchObject({ total: 3, valid: 3, newCount: 3 });
    expect(previewRes.body.rows[0]).toMatchObject({
      description: `${RULE_PREFIX} FUEL STOP 882`,
      amount: -64.2,
      rule: {
        id: specific.id,
        descriptionContains: `${RULE_PREFIX} FUEL STOP`,
        targetAccount: { code: '6300', name: 'Professional fees' },
      },
    });
    expect(previewRes.body.rows[1]).toMatchObject({
      description: `MONTHLY ${RULE_PREFIX} FUEL CHARGE`,
      rule: { id: broad.id, targetAccount: { code: '6400' } },
    });
    expect(previewRes.body.rows[2]).toMatchObject({
      description: `CUSTOMER ${RULE_PREFIX} DEPOSIT`,
      rule: {
        id: deposit.id,
        targetAccount: { code: '4000', name: 'Sales income' },
      },
    });

    const imported = await confirm(accountId).expect(201);
    expect(imported.body.batch).toMatchObject({ importedCount: 3, duplicateCount: 0 });
    expect(imported.body.transactions).toHaveLength(3);
    expect(imported.body.transactions[0]).toMatchObject({
      description: `${RULE_PREFIX} FUEL STOP 882`,
      matchState: 'CATEGORIZED',
      categoryAccountId: professionalAccountId,
      categoryRuleId: specific.id,
    });
    expect(imported.body.transactions[1]).toMatchObject({
      description: `MONTHLY ${RULE_PREFIX} FUEL CHARGE`,
      matchState: 'CATEGORIZED',
      categoryAccountId: bankFeesAccountId,
      categoryRuleId: broad.id,
    });
    expect(imported.body.transactions[2]).toMatchObject({
      description: `CUSTOMER ${RULE_PREFIX} DEPOSIT`,
      matchState: 'CATEGORIZED',
      categoryAccountId: salesIncomeAccountId,
      categoryRuleId: deposit.id,
    });

    const list = await call('get', `/bank-transactions?bankAccountId=${accountId}`, viewerToken, acmeId).expect(200);
    const transactions = list.body.transactions as BankTransactionView[];
    expect(transactions.find((row) => row.description === `${RULE_PREFIX} FUEL STOP 882`)).toMatchObject({
      matchState: 'CATEGORIZED',
      categoryAccount: { code: '6300' },
      categoryRule: { id: specific.id, descriptionContains: `${RULE_PREFIX} FUEL STOP` },
    });

    const journals = await call(
      'get',
      '/journal-entries?from=2026-10-01&to=2026-10-03&limit=200',
      ownerToken,
      acmeId,
    ).expect(200);
    const bankEntries = (journals.body.entries as JournalEntryView[]).filter(
      (entry) =>
        entry.sourceType === 'BANK' &&
        transactions.some((transaction) => transaction.id === entry.sourceId),
    );
    expect(bankEntries).toHaveLength(3);
    const fuelEntry = bankEntries.find(
      (entry) =>
        entry.sourceId === transactions.find((row) => row.description === `${RULE_PREFIX} FUEL STOP 882`)?.id,
    )!;
    expect(fuelEntry.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: professionalAccountId, debit: 64.2, credit: 0 }),
        expect.objectContaining({ accountId: cashAccountId, debit: 0, credit: 64.2 }),
      ]),
    );
    const depositEntry = bankEntries.find(
      (entry) =>
        entry.sourceId === transactions.find((row) => row.description === `CUSTOMER ${RULE_PREFIX} DEPOSIT`)?.id,
    )!;
    expect(depositEntry.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: cashAccountId, debit: 1200, credit: 0 }),
        expect.objectContaining({ accountId: salesIncomeAccountId, debit: 0, credit: 1200 }),
      ]),
    );

    const duplicate = await confirm(accountId).expect(201);
    expect(duplicate.body.batch).toMatchObject({
      importedCount: 0,
      duplicateCount: 3,
    });
    const after = await call(
      'get',
      `/journal-entries?from=2026-10-01&to=2026-10-03&limit=200`,
      ownerToken,
      acmeId,
    ).expect(200);
    const afterBankEntries = (after.body.entries as JournalEntryView[]).filter(
      (entry) =>
        entry.sourceType === 'BANK' &&
        transactions.some((transaction) => transaction.id === entry.sourceId),
    );
    expect(afterBankEntries).toHaveLength(3);
  });

  it('keeps preview and import usable when no rule matches', async () => {
    const accountId = await createBankAccount(`${TEST_PREFIX} No matches`);
    const file = csvFile(
      `${CSV_HEADERS}\n2026-10-04,UNCATEGORIZED SOFTWARE,-99.00,${RULE_PREFIX}-TXN-4\n`,
      'test-rule-no-match.csv',
    );

    const previewRes = await preview(accountId, file).expect(200);
    expect(previewRes.body.mappingError).toBeNull();
    expect(previewRes.body.counts).toMatchObject({ valid: 1, newCount: 1 });
    expect(previewRes.body.rows[0]).toMatchObject({
      description: 'UNCATEGORIZED SOFTWARE',
      rule: null,
    });

    const imported = await confirm(accountId, file).expect(201);
    expect(imported.body.transactions[0]).toMatchObject({
      matchState: 'UNMATCHED',
      categoryAccountId: null,
      categoryRuleId: null,
    });
  });
});
