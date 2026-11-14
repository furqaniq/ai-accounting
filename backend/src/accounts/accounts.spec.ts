import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string | null;
  active: boolean;
}

interface AuditRow {
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
}

describe('Chart of accounts', () => {
  let app: INestApplication;
  let ownerToken: string;
  let accountantToken: string;
  let staffToken: string;
  let viewerToken: string;
  let nimbusOwnerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let createdId: string;
  let prisma: PrismaService;

  async function clearTestAccounts(): Promise<void> {
    await prisma.account.deleteMany({ where: { code: { in: ['6550', '6560', '7120', '7770'] } } });
  }

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

  async function accounts(token: string, orgId: string, query = ''): Promise<AccountRow[]> {
    const res = await call('get', `/accounts${query}`, token, orgId).expect(200);
    return res.body.accounts as AccountRow[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await clearTestAccounts();

    [ownerToken, accountantToken, staffToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('accountant@acme.test'),
      login('staff@acme.test'),
      login('viewer@acme.test'),
      login('owner@nimbus.test'),
    ]);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    acmeId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Acme Services Co.',
    ).organizationId;
    nimbusId = me.body.memberships.find(
      (m: { organizationName: string }) => m.organizationName === 'Nimbus Retail LLC',
    ).organizationId;
  });

  afterAll(async () => {
    await clearTestAccounts();
    await app.close();
  });

  it('ships the default industry-neutral chart in every organization', async () => {
    const acme = await accounts(viewerToken, acmeId);
    expect(acme.map((a) => a.code)).toEqual(
      expect.arrayContaining(['1000', '2000', '3000', '4000', '6000']),
    );
    expect(new Set(acme.map((a) => a.type))).toEqual(
      new Set(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
    );
    expect(acme.find((a) => a.code === '1000')).toMatchObject({
      name: 'Cash',
      subtype: 'Current asset',
      active: true,
    });

    const nimbus = await accounts(nimbusOwnerToken, nimbusId);
    expect(nimbus.length).toBe(acme.length);
    expect(nimbus[0].id).not.toBe(acme[0].id);
  });

  it('lists accounts with stable codes and lets staff and viewers read them', async () => {
    for (const token of [accountantToken, staffToken, viewerToken]) {
      const rows = await accounts(token, acmeId);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((a) => a.code)).toEqual([...rows.map((a) => a.code)].sort());
    }

    const assets = await accounts(accountantToken, acmeId, '?type=ASSET');
    expect(assets.length).toBeGreaterThan(0);
    for (const account of assets) expect(account.type).toBe('ASSET');

    await call('get', '/accounts?type=NOT_A_TYPE', accountantToken, acmeId).expect(400);
  });

  it('lets an accountant create an account', async () => {
    const res = await call('post', '/accounts', accountantToken, acmeId)
      .send({
        code: '6550',
        name: 'Software subscriptions',
        type: 'EXPENSE',
        subtype: 'Operating expense',
      })
      .expect(201);

    createdId = res.body.id;
    expect(res.body).toMatchObject({
      code: '6550',
      name: 'Software subscriptions',
      type: 'EXPENSE',
      subtype: 'Operating expense',
      active: true,
    });

    const rows = await accounts(accountantToken, acmeId);
    expect(rows.filter((a) => a.code === '6550')).toHaveLength(1);
  });

  it('rejects duplicate codes within the organization', async () => {
    await call('post', '/accounts', ownerToken, acmeId)
      .send({ code: '6550', name: 'Duplicate', type: 'EXPENSE' })
      .expect(409);

    await call('post', '/accounts', nimbusOwnerToken, nimbusId)
      .send({ code: '6550', name: 'Same code, other book', type: 'EXPENSE' })
      .expect(201);
  });

  it('validates account input', async () => {
    const cases = [
      { code: '', name: 'No code', type: 'ASSET' },
      { code: '6 55', name: 'Bad code', type: 'ASSET' },
      { code: '7000', name: '', type: 'ASSET' },
      { code: '7001', name: 'No type' },
      { code: '7002', name: 'Bad type', type: 'REVENUE' },
      { code: '7003', name: 'Unknown field', type: 'ASSET', balance: 100 },
    ];

    for (const body of cases) {
      await call('post', '/accounts', accountantToken, acmeId).send(body).expect(400);
    }
  });

  it('refuses account changes from staff, viewers, and admins are allowed', async () => {
    await call('post', '/accounts', staffToken, acmeId)
      .send({ code: '7100', name: 'Staff attempt', type: 'ASSET' })
      .expect(403);
    await call('post', '/accounts', viewerToken, acmeId)
      .send({ code: '7101', name: 'Viewer attempt', type: 'ASSET' })
      .expect(403);

    const res = await call('post', '/accounts', ownerToken, acmeId)
      .send({ code: '7120', name: 'Owner created', type: 'ASSET' })
      .expect(201);
    await call('patch', `/accounts/${res.body.id}`, ownerToken, acmeId)
      .send({ active: false })
      .expect(200);
  });

  it('lets an accountant edit an account and records the change', async () => {
    const res = await call('patch', `/accounts/${createdId}`, accountantToken, acmeId)
      .send({ name: 'Software and tools', subtype: 'General expense' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Software and tools', subtype: 'General expense' });

    const audit = await call('get', '/audit-log?action=account.update', ownerToken, acmeId).expect(
      200,
    );
    const entries = audit.body.entries as AuditRow[];
    expect(entries.some((e) => e.entityId === createdId)).toBe(true);

    const unauthorized = await call('patch', `/accounts/${createdId}`, viewerToken, acmeId)
      .send({ name: 'Viewer edit' })
      .expect(403);
    expect(unauthorized.body.message).toBeDefined();
  });

  it('deactivates accounts without deleting them or hiding history', async () => {
    const res = await call('patch', `/accounts/${createdId}`, accountantToken, acmeId)
      .send({ active: false })
      .expect(200);
    expect(res.body.active).toBe(false);

    const all = await accounts(accountantToken, acmeId);
    expect(all.find((a) => a.id === createdId)).toMatchObject({
      code: '6550',
      active: false,
    });

    const activeOnly = await accounts(accountantToken, acmeId, '?active=true');
    expect(activeOnly.map((a) => a.id)).not.toContain(createdId);

    await call('delete', `/accounts/${createdId}`, accountantToken, acmeId).expect(404);
  });

  it('keeps accounts isolated between organizations', async () => {
    const nimbus = await accounts(nimbusOwnerToken, nimbusId);
    expect(nimbus.map((a) => a.id)).not.toContain(createdId);
    expect(nimbus.map((a) => a.name)).not.toContain('Software and tools');

    await call('patch', `/accounts/${createdId}`, nimbusOwnerToken, nimbusId)
      .send({ name: 'Cross-org write' })
      .expect(404);
  });
});
