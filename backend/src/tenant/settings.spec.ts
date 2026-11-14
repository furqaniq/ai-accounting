import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';

interface SettingsBody {
  organizationId: string;
  name: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  baseCurrency: string;
  defaultTaxRate: number;
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  actor: { email: string };
}

describe('Organization settings and audit log', () => {
  let app: INestApplication;
  let ownerToken: string;
  let accountantToken: string;
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

  function call(method: 'get' | 'patch' | 'delete' | 'post', path: string, token: string, orgId: string) {
    return request(app.getHttpServer())[method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    [ownerToken, accountantToken, viewerToken, nimbusOwnerToken] = await Promise.all([
      login('owner@acme.test'),
      login('accountant@acme.test'),
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
    await call('patch', '/organizations/settings', ownerToken, acmeId)
      .send({
        name: 'Acme Services Co.',
        fiscalYearStartMonth: 1,
        fiscalYearStartDay: 1,
        baseCurrency: 'USD',
        defaultTaxRate: 0,
      })
      .expect(200);
    await app.close();
  });

  it('reads the organization settings for a member', async () => {
    const res = await call('get', '/organizations/settings', viewerToken, acmeId).expect(200);

    expect(res.body).toMatchObject<Partial<SettingsBody>>({
      organizationId: acmeId,
      name: 'Acme Services Co.',
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      baseCurrency: 'USD',
      defaultTaxRate: 0,
    });
  });

  it('lets an owner update settings and persists them', async () => {
    const res = await call('patch', '/organizations/settings', ownerToken, acmeId)
      .send({
        name: 'Acme Services',
        fiscalYearStartMonth: 4,
        fiscalYearStartDay: 6,
        baseCurrency: 'CAD',
        defaultTaxRate: 0.075,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      name: 'Acme Services',
      fiscalYearStartMonth: 4,
      fiscalYearStartDay: 6,
      baseCurrency: 'CAD',
      defaultTaxRate: 0.075,
    });

    const read = await call('get', '/organizations/settings', accountantToken, acmeId).expect(200);
    expect(read.body).toMatchObject({ name: 'Acme Services', baseCurrency: 'CAD' });
  });

  it('records the settings change with before and after values', async () => {
    const res = await call('get', '/audit-log?action=org.settings.update', ownerToken, acmeId).expect(
      200,
    );
    const entry = (res.body.entries as AuditRow[])[0];
    expect(entry).toMatchObject({
      action: 'org.settings.update',
      entityType: 'Organization',
      entityId: acmeId,
      actor: { email: 'owner@acme.test' },
    });
    expect(entry.metadata).toMatchObject({
      changes: {
        name: { from: 'Acme Services Co.', to: 'Acme Services' },
        defaultTaxRate: { from: 0, to: 0.075 },
      },
    });
  });

  it('validates settings input', async () => {
    const cases = [
      { fiscalYearStartMonth: 13 },
      { fiscalYearStartMonth: 0 },
      { fiscalYearStartDay: 32 },
      { fiscalYearStartDay: 0 },
      { defaultTaxRate: 1.5 },
      { defaultTaxRate: -0.1 },
      { name: '' },
      { baseCurrency: 'US' },
      { unknownField: true },
    ];

    for (const body of cases) {
      await call('patch', '/organizations/settings', ownerToken, acmeId).send(body).expect(400);
    }
  });

  it('refuses settings changes from non-admins', async () => {
    await call('patch', '/organizations/settings', accountantToken, acmeId)
      .send({ name: 'Accountant Takeover' })
      .expect(403);
    await call('patch', '/organizations/settings', viewerToken, acmeId)
      .send({ name: 'Viewer Takeover' })
      .expect(403);

    const res = await call('get', '/organizations/settings', ownerToken, acmeId).expect(200);
    expect(res.body.name).toBe('Acme Services');
  });

  it('keeps the audit log append-only', async () => {
    const before = await call('get', '/audit-log', ownerToken, acmeId).expect(200);
    const entry = (before.body.entries as AuditRow[])[0];

    await call('patch', `/audit-log/${entry.id}`, ownerToken, acmeId)
      .send({ action: 'org.settings.update' })
      .expect(404);
    await call('delete', `/audit-log/${entry.id}`, ownerToken, acmeId).expect(404);

    const after = await call('get', '/audit-log', ownerToken, acmeId).expect(200);
    expect((after.body.entries as AuditRow[]).length).toBe(
      (before.body.entries as AuditRow[]).length,
    );
  });

  it('filters the audit log and honours the result limit', async () => {
    await call('patch', '/organizations/settings', ownerToken, acmeId)
      .send({ defaultTaxRate: 0.08 })
      .expect(200);

    const byAction = await call(
      'get',
      '/audit-log?action=org.settings.update',
      ownerToken,
      acmeId,
    ).expect(200);
    const actions = (byAction.body.entries as AuditRow[]).map((e) => e.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions)).toEqual(new Set(['org.settings.update']));

    const byType = await call('get', '/audit-log?entityType=OrgMembership', ownerToken, acmeId);
    for (const e of byType.body.entries as AuditRow[]) {
      expect(e.entityType).toBe('OrgMembership');
    }

    const limited = await call('get', '/audit-log?limit=1', ownerToken, acmeId).expect(200);
    expect((limited.body.entries as AuditRow[]).length).toBe(1);

    await call('get', '/audit-log?limit=500', ownerToken, acmeId).expect(400);
  });

  it('scopes the audit log to the active organization', async () => {
    const res = await call('get', '/audit-log', nimbusOwnerToken, nimbusId).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(acmeId);
  });
});
