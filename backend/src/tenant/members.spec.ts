import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';
import { PrismaService } from '../prisma/prisma.service';

interface MembershipRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { email: string };
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

describe('Members and RBAC', () => {
  let app: INestApplication;
  let ownerToken: string;
  let accountantToken: string;
  let staffToken: string;
  let viewerToken: string;
  let acmeId: string;
  let nimbusId: string;
  let addedMembershipId: string | undefined;
  let accountantMembershipId: string;
  let staffMembershipId: string;
  let ownerMembershipId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken as string;
  }

  function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string, orgId: string) {
    return request(app.getHttpServer())[method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    const prisma = moduleRef.get(PrismaService);
    const acme = await prisma.organization.findFirst({ where: { name: 'Acme Services Co.' } });
    for (const email of ['accountant@nimbus.test', 'owner@nimbus.test']) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (acme && user) {
        await prisma.orgMembership.deleteMany({
          where: { organizationId: acme.id, userId: user.id },
        });
      }
    }
    for (const [email, role] of [
      ['owner@acme.test', 'OWNER'],
      ['accountant@acme.test', 'ACCOUNTANT'],
      ['staff@acme.test', 'STAFF'],
    ] as const) {
      const user = await prisma.user.findUnique({ where: { email } });
      const org = await prisma.organization.findFirst({ where: { name: 'Acme Services Co.' } });
      if (user && org) {
        await prisma.orgMembership.updateMany({
          where: { organizationId: org.id, userId: user.id },
          data: { role },
        });
      }
    }

    ownerToken = await login('owner@acme.test');
    accountantToken = await login('accountant@acme.test');
    staffToken = await login('staff@acme.test');
    viewerToken = await login('viewer@acme.test');

    const me = await call('get', '/api/v1/auth/me', ownerToken, '').expect(200);
    for (const m of me.body.memberships as Array<{ organizationId: string; organizationName: string }>) {
      if (m.organizationName === 'Acme Services Co.') acmeId = m.organizationId;
      if (m.organizationName === 'Nimbus Retail LLC') nimbusId = m.organizationId;
    }

    const roster = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    for (const m of roster.body.memberships as MembershipRow[]) {
      if (m.email === 'accountant@acme.test') accountantMembershipId = m.id;
      if (m.email === 'staff@acme.test') staffMembershipId = m.id;
      if (m.email === 'owner@acme.test') ownerMembershipId = m.id;
    }
  });

  afterAll(async () => {
    if (addedMembershipId) {
      await call('delete', `/api/v1/memberships/${addedMembershipId}`, ownerToken, acmeId);
    }
    await call('patch', `/api/v1/memberships/${accountantMembershipId}`, ownerToken, acmeId).send({
      role: 'ACCOUNTANT',
    });
    await call('patch', `/api/v1/memberships/${staffMembershipId}`, ownerToken, acmeId).send({
      role: 'STAFF',
    });
    await app.close();
  });

  it('lets an owner add an existing user to the organization', async () => {
    const res = await call('post', '/api/v1/memberships', ownerToken, acmeId)
      .send({ email: 'accountant@nimbus.test', role: 'ACCOUNTANT' })
      .expect(201);

    expect(res.body).toMatchObject({
      email: 'accountant@nimbus.test',
      role: 'ACCOUNTANT',
      id: expect.any(String),
    });
    addedMembershipId = res.body.id;

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const emails = (list.body.memberships as MembershipRow[]).map((m) => m.email);
    expect(emails).toContain('accountant@nimbus.test');
  });

  it('refuses to add an email that is not a user', async () => {
    await call('post', '/api/v1/memberships', ownerToken, acmeId)
      .send({ email: 'nobody@example.test', role: 'STAFF' })
      .expect(404);
  });

  it('refuses to add the same user twice', async () => {
    await call('post', '/api/v1/memberships', ownerToken, acmeId)
      .send({ email: 'accountant@nimbus.test', role: 'STAFF' })
      .expect(409);
  });

  it('refuses member management from an accountant', async () => {
    await call('post', '/api/v1/memberships', accountantToken, acmeId)
      .send({ email: 'owner@nimbus.test', role: 'STAFF' })
      .expect(403);

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const emails = (list.body.memberships as MembershipRow[]).map((m) => m.email);
    expect(emails).not.toContain('owner@nimbus.test');
  });

  it('refuses member management from staff', async () => {
    await call('patch', `/api/v1/memberships/${accountantMembershipId}`, staffToken, acmeId)
      .send({ role: 'ADMIN' })
      .expect(403);

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const accountant = (list.body.memberships as MembershipRow[]).find(
      (m) => m.email === 'accountant@acme.test',
    );
    expect(accountant?.role).toBe('ACCOUNTANT');
  });

  it('refuses member management from a viewer', async () => {
    await call('post', '/api/v1/memberships', viewerToken, acmeId)
      .send({ email: 'owner@nimbus.test', role: 'STAFF' })
      .expect(403);

    await call('delete', `/api/v1/memberships/${accountantMembershipId}`, viewerToken, acmeId).expect(
      403,
    );
  });

  it('lets an owner change a member role', async () => {
    const res = await call(
      'patch',
      `/api/v1/memberships/${accountantMembershipId}`,
      ownerToken,
      acmeId,
    )
      .send({ role: 'ADMIN' })
      .expect(200);

    expect(res.body).toMatchObject({ email: 'accountant@acme.test', role: 'ADMIN' });

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const accountant = (list.body.memberships as MembershipRow[]).find(
      (m) => m.email === 'accountant@acme.test',
    );
    expect(accountant?.role).toBe('ADMIN');
  });

  it('refuses to demote the only owner', async () => {
    await call('patch', `/api/v1/memberships/${ownerMembershipId}`, ownerToken, acmeId)
      .send({ role: 'STAFF' })
      .expect(400);

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const owner = (list.body.memberships as MembershipRow[]).find(
      (m) => m.email === 'owner@acme.test',
    );
    expect(owner?.role).toBe('OWNER');
  });

  it('refuses to remove the only owner', async () => {
    await call('delete', `/api/v1/memberships/${ownerMembershipId}`, ownerToken, acmeId).expect(400);

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    const emails = (list.body.memberships as MembershipRow[]).map((m) => m.email);
    expect(emails).toContain('owner@acme.test');
  });

  it('lets an admin manage members', async () => {
    await call('patch', `/api/v1/memberships/${staffMembershipId}`, ownerToken, acmeId)
      .send({ role: 'ADMIN' })
      .expect(200);

    const added = await call('post', '/api/v1/memberships', staffToken, acmeId)
      .send({ email: 'owner@nimbus.test', role: 'STAFF' })
      .expect(201);

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    expect((list.body.memberships as MembershipRow[]).map((m) => m.email)).toContain(
      'owner@nimbus.test',
    );

    await call('delete', `/api/v1/memberships/${added.body.id}`, staffToken, acmeId).expect(204);
  });

  it('lets an owner remove a member', async () => {
    await call('delete', `/api/v1/memberships/${addedMembershipId}`, ownerToken, acmeId).expect(204);
    addedMembershipId = undefined;

    const list = await call('get', '/api/v1/memberships', ownerToken, acmeId).expect(200);
    expect((list.body.memberships as MembershipRow[]).map((m) => m.email)).not.toContain(
      'accountant@nimbus.test',
    );
  });

  it('records membership changes in the organization audit log', async () => {
    const res = await call('get', '/api/v1/audit-log', ownerToken, acmeId).expect(200);

    const entries = res.body.entries as AuditRow[];
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['membership.create', 'membership.role_change', 'membership.delete']),
    );

    const created = entries.find(
      (e) => e.action === 'membership.create' && e.metadata?.email === 'accountant@nimbus.test',
    );
    expect(created).toMatchObject({
      entityType: 'OrgMembership',
      actor: { email: 'owner@acme.test' },
    });
    expect(JSON.stringify(res.body)).not.toContain(nimbusId);
  });

  it('refuses audit log access to a viewer', async () => {
    await call('get', '/api/v1/audit-log', viewerToken, acmeId).expect(403);
  });
});
