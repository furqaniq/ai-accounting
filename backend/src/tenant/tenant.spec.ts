import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.factory';

interface MembershipRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

describe('Tenant isolation', () => {
  let app: INestApplication;
  let ownerToken: string;
  let acmeId: string;
  let nimbusId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Passw0rd!2026' })
      .expect(200);
    return res.body.accessToken as string;
  }

  function asOwner(orgId?: string) {
    const req = request(app.getHttpServer())
      .get('/api/v1/organizations/active')
      .set('Authorization', `Bearer ${ownerToken}`);
    return orgId ? req.set('X-Organization-Id', orgId) : req;
  }

  function members(orgId: string, token = ownerToken) {
    return request(app.getHttpServer())
      .get('/api/v1/memberships')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();

    ownerToken = await login('owner@acme.test');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const memberships = me.body.memberships as Array<{ organizationId: string; organizationName: string }>;
    acmeId = memberships.find((m) => m.organizationName === 'Acme Services Co.')!.organizationId;
    nimbusId = memberships.find((m) => m.organizationName === 'Nimbus Retail LLC')!.organizationId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an authenticated request without an active organization', async () => {
    await asOwner().expect(400);
  });

  it('resolves the active organization and the caller role', async () => {
    const res = await asOwner(acmeId).expect(200);

    expect(res.body).toEqual({
      organizationId: acmeId,
      organizationName: 'Acme Services Co.',
      role: 'OWNER',
    });
  });

  it('resolves a distinct role when the user switches organizations', async () => {
    const res = await asOwner(nimbusId).expect(200);

    expect(res.body).toEqual({
      organizationId: nimbusId,
      organizationName: 'Nimbus Retail LLC',
      role: 'ACCOUNTANT',
    });
  });

  it('refuses an organization the caller does not belong to', async () => {
    const viewerToken = await login('viewer@acme.test');

    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/active')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('X-Organization-Id', nimbusId)
      .expect(403);

    expect(JSON.stringify(res.body)).not.toContain(nimbusId);
  });

  it('lists only the members of the active organization', async () => {
    const res = await members(acmeId).expect(200);

    const emails = (res.body.memberships as MembershipRow[]).map((m) => m.email).sort();
    expect(emails).toEqual([
      'accountant@acme.test',
      'owner@acme.test',
      'staff@acme.test',
      'viewer@acme.test',
    ]);
    expect(JSON.stringify(res.body)).not.toContain(nimbusId);
    expect(JSON.stringify(res.body)).not.toContain('nimbus.test');
  });

  it('lists a different roster for the other organization', async () => {
    const res = await members(nimbusId).expect(200);

    const emails = (res.body.memberships as MembershipRow[]).map((m) => m.email).sort();
    expect(emails).toEqual([
      'accountant@nimbus.test',
      'owner@acme.test',
      'owner@nimbus.test',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('accountant@acme.test');
    expect(JSON.stringify(res.body)).not.toContain('staff@acme.test');
    expect(JSON.stringify(res.body)).not.toContain(acmeId);
  });

  it('reads a member of the active organization by id', async () => {
    const list = await members(acmeId).expect(200);
    const member = (list.body.memberships as MembershipRow[])[0];

    const res = await request(app.getHttpServer())
      .get(`/api/v1/memberships/${member.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .expect(200);

    expect(res.body).toEqual(member);
  });

  it('hides a member of another organization behind a direct id lookup', async () => {
    const nimbusList = await members(nimbusId).expect(200);
    const nimbusMember = (nimbusList.body.memberships as MembershipRow[]).find(
      (m) => m.email === 'accountant@nimbus.test',
    )!;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/memberships/${nimbusMember.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .expect(404);

    expect(JSON.stringify(res.body)).not.toContain(nimbusMember.id);
    expect(JSON.stringify(res.body)).not.toContain(nimbusId);
  });

  it('returns 404 for an unknown member id', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/memberships/does-not-exist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', acmeId)
      .expect(404);
  });

  it('requires a signed-in caller for tenant-scoped endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/memberships')
      .set('X-Organization-Id', acmeId)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/organizations/active')
      .set('X-Organization-Id', acmeId)
      .expect(401);
  });
});
