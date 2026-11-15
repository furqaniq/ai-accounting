import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface AttachmentView {
  id: string;
  entityType: 'EXPENSE' | 'BILL';
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

function binaryParser(
  res: SuperAgentResponse,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Attachments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let suppliesAccountId: string;
  let billId: string;

  const TEST_PREFIX = 'TEST ATTACH';
  const TEST_FILENAME = 'test-attach';
  const MAX_BYTES = 10 * 1024 * 1024;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken;
  }

  function call(
    method: 'get' | 'post' | 'delete',
    path: string,
    token: string,
    orgId: string,
  ) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  async function clearTestRows(): Promise<void> {
    await prisma.attachment.deleteMany({
      where: { organizationId: acmeId, filename: { startsWith: TEST_FILENAME } },
    });
    const expenses = await prisma.expense.findMany({
      where: { organizationId: acmeId, memo: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    if (expenses.length === 0) return;

    const ids = expenses.map((expense) => expense.id);
    const originals = await prisma.journalEntry.findMany({
      where: {
        organizationId: acmeId,
        sourceType: 'EXPENSE',
        OR: ids.map((id) => ({ sourceId: { startsWith: id } })),
      },
      select: { id: true },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        organizationId: acmeId,
        OR: [
          ...ids.map((id) => ({ sourceType: 'EXPENSE' as const, sourceId: { startsWith: id } })),
          { sourceType: 'REVERSAL' as const, sourceId: { in: originals.map((row) => row.id) } },
        ],
      },
    });
    await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  }

  async function createExpense(memo = TEST_PREFIX): Promise<string> {
    const res = await call('post', '/expenses', staffToken, acmeId)
      .send({
        date: '2026-11-12',
        categoryAccountId: suppliesAccountId,
        amount: 21.5,
        memo,
        receiptNote: 'awaiting scan',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function upload(
    entityId: string,
    filename = `${TEST_FILENAME}-receipt.pdf`,
    contentType = 'application/pdf',
    body: Buffer = PDF,
  ) {
    return call('post', '/attachments', staffToken, acmeId)
      .field('entityType', 'EXPENSE')
      .field('entityId', entityId)
      .attach('file', body, { filename, contentType });
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

    const [accounts, bills] = await Promise.all([
      call('get', '/accounts', ownerToken, acmeId).expect(200),
      call('get', '/bills', ownerToken, acmeId).expect(200),
    ]);
    suppliesAccountId = (
      accounts.body.accounts as Array<{ id: string; code: string }>
    ).find((account) => account.code === '6200')!.id;
    billId = (bills.body.bills as Array<{ id: string }>)[0].id;
  });

  beforeEach(async () => {
    await clearTestRows();
  });

  afterAll(async () => {
    await clearTestRows();
    await app.close();
  });

  it('uploads, lists, downloads, signs, and removes a receipt', async () => {
    const expenseId = await createExpense();

    const uploaded = await upload(expenseId, '../../test-attach receipt.pdf').expect(201);
    const attachment = uploaded.body as AttachmentView;
    expect(attachment).toMatchObject({
      entityType: 'EXPENSE',
      entityId: expenseId,
      filename: 'test-attach-receipt.pdf',
      contentType: 'application/pdf',
      size: PDF.length,
    });

    const list = await call(
      'get',
      `/attachments?entityType=EXPENSE&entityId=${expenseId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(list.body.attachments).toHaveLength(1);
    expect(list.body.attachments[0].id).toBe(attachment.id);

    const download = await call(
      'get',
      `/attachments/${attachment.id}/download`,
      viewerToken,
      acmeId,
    )
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment; filename="test-attach-receipt.pdf"');
    expect(download.body.subarray(0, 5).toString()).toBe('%PDF-');

    const signed = await call(
      'get',
      `/attachments/${attachment.id}/url`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(signed.body.url).toContain('test-attach-receipt.pdf');

    const audit = await call(
      'get',
      '/audit-log?action=attachment.upload&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      audit.body.entries.find((row: { entityId: string }) => row.entityId === attachment.id),
    ).toMatchObject({
      entityType: 'Attachment',
      action: 'attachment.upload',
      metadata: {
        entityType: 'EXPENSE',
        entityId: expenseId,
        filename: 'test-attach-receipt.pdf',
      },
    });

    await call('delete', `/attachments/${attachment.id}`, staffToken, acmeId).expect(204);
    await call(
      'get',
      `/attachments?entityType=EXPENSE&entityId=${expenseId}`,
      viewerToken,
      acmeId,
    ).expect(200, { attachments: [] });
    await call(
      'get',
      `/attachments/${attachment.id}/download`,
      viewerToken,
      acmeId,
    ).expect(404);

    const deleted = await call(
      'get',
      '/audit-log?action=attachment.delete&limit=10',
      ownerToken,
      acmeId,
    ).expect(200);
    expect(
      deleted.body.entries.some((row: { entityId: string }) => row.entityId === attachment.id),
    ).toBe(true);
  });

  it('attaches documents to bills and isolates tenants and read-only roles', async () => {
    const billAttachment = await call('post', '/attachments', ownerToken, acmeId)
      .field('entityType', 'BILL')
      .field('entityId', billId)
      .attach('file', PDF, {
        filename: `${TEST_FILENAME}-bill.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);

    const billList = await call(
      'get',
      `/attachments?entityType=BILL&entityId=${billId}`,
      viewerToken,
      acmeId,
    ).expect(200);
    expect(billList.body.attachments.some((row: AttachmentView) => row.id === billAttachment.body.id)).toBe(true);

    const expenseId = await createExpense(`${TEST_PREFIX} tenant check`);
    const receipt = await upload(expenseId).expect(201);

    await call('post', '/attachments', viewerToken, acmeId)
      .field('entityType', 'EXPENSE')
      .field('entityId', expenseId)
      .attach('file', PDF, {
        filename: `${TEST_FILENAME}-viewer.pdf`,
        contentType: 'application/pdf',
      })
      .expect(403);
    await call('delete', `/attachments/${receipt.body.id}`, viewerToken, acmeId).expect(403);

    await call(
      'get',
      `/attachments?entityType=EXPENSE&entityId=${expenseId}`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(404);
    await call(
      'get',
      `/attachments/${receipt.body.id}/download`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(404);
    await call(
      'delete',
      `/attachments/${receipt.body.id}`,
      nimbusOwnerToken,
      nimbusId,
    ).expect(404);
    await call('post', '/attachments', nimbusOwnerToken, nimbusId)
      .field('entityType', 'EXPENSE')
      .field('entityId', expenseId)
      .attach('file', PDF, {
        filename: `${TEST_FILENAME}-foreign.pdf`,
        contentType: 'application/pdf',
      })
      .expect(404);

    await call('delete', `/attachments/${receipt.body.id}`, staffToken, acmeId).expect(204);
    await call('delete', `/attachments/${billAttachment.body.id}`, staffToken, acmeId).expect(204);
  });

  it('rejects empty, oversized, unsupported, and mismatched files', async () => {
    const expenseId = await createExpense(`${TEST_PREFIX} validation`);

    await upload(expenseId, `${TEST_FILENAME}-notes.txt`, 'text/plain', Buffer.from('hello'))
      .expect(400);

    await upload(
      expenseId,
      `${TEST_FILENAME}-receipt.png`,
      'image/png',
      Buffer.from('not a png'),
    ).expect(400);

    await upload(
      expenseId,
      `${TEST_FILENAME}-receipt.pdf`,
      'image/png',
      PDF,
    ).expect(400);

    await upload(expenseId, `${TEST_FILENAME}-empty.pdf`, 'application/pdf', Buffer.alloc(0))
      .expect(400);

    await upload(
      expenseId,
      `${TEST_FILENAME}-large.pdf`,
      'application/pdf',
      Buffer.alloc(MAX_BYTES + 1, 0x20),
    ).expect(413);
  });
});
