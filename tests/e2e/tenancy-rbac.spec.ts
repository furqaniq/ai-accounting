import { APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PASSWORD = 'Passw0rd!2026';

interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

interface Session {
  token: string;
  memberships: Membership[];
}

type Headers = { Authorization: string; 'X-Organization-Id': string };

async function login(request: APIRequestContext, email: string): Promise<Session> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `login failed for ${email}`).toBeTruthy();
  const body = (await res.json()) as {
    accessToken: string;
    memberships: Membership[];
  };
  return { token: body.accessToken, memberships: body.memberships };
}

function orgId(session: Session, namePrefix: string): string {
  const membership = session.memberships.find((entry) =>
    entry.organizationName.startsWith(namePrefix),
  );
  expect(membership, `missing ${namePrefix} membership`).toBeTruthy();
  return membership!.organizationId;
}

function headers(session: Session, organizationId: string): Headers {
  return {
    Authorization: `Bearer ${session.token}`,
    'X-Organization-Id': organizationId,
  };
}

async function listIds(
  request: APIRequestContext,
  auth: Headers,
  path: string,
  key: string,
): Promise<string[]> {
  const res = await request.get(`${API}${path}`, { headers: auth });
  expect(res.ok(), `GET ${path} failed`).toBeTruthy();
  const body = (await res.json()) as Record<string, Array<{ id: string }>>;
  return body[key].map((row) => row.id);
}

async function firstId(
  request: APIRequestContext,
  auth: Headers,
  path: string,
  key: string,
): Promise<string> {
  const ids = await listIds(request, auth, path, key);
  expect(ids.length, `expected seeded rows in ${path}`).toBeGreaterThan(0);
  return ids[0];
}

test('auth: seeded login succeeds and missing or invalid tokens are rejected', async ({
  request,
}) => {
  const owner = await login(request, 'owner@acme.test');
  const acme = orgId(owner, 'Acme');
  expect(owner.token).toBeTruthy();

  const noToken = await request.get(`${API}/accounts`, {
    headers: { 'X-Organization-Id': acme },
  });
  expect(noToken.status()).toBe(401);

  const invalidToken = await request.get(`${API}/accounts`, {
    headers: { Authorization: 'Bearer not-a-real-token', 'X-Organization-Id': acme },
  });
  expect(invalidToken.status()).toBe(401);
});

test('tenancy: rejects a foreign organization header and keeps legitimate membership access', async ({
  request,
}) => {
  const staff = await login(request, 'staff@acme.test');
  const nimbusOwner = await login(request, 'owner@nimbus.test');
  const acmeOwner = await login(request, 'owner@acme.test');
  const acme = orgId(staff, 'Acme');
  const nimbus = orgId(nimbusOwner, 'Nimbus');

  const staffIntoNimbus = await request.get(`${API}/organizations/active`, {
    headers: headers(staff, nimbus),
  });
  expect(staffIntoNimbus.status()).toBe(403);

  const nimbusIntoAcme = await request.get(`${API}/organizations/active`, {
    headers: headers(nimbusOwner, acme),
  });
  expect(nimbusIntoAcme.status()).toBe(403);

  const ownerIntoNimbus = await request.get(`${API}/organizations/active`, {
    headers: headers(acmeOwner, nimbus),
  });
  expect(ownerIntoNimbus.status()).toBe(200);
  expect((await ownerIntoNimbus.json()).role).toBe('ACCOUNTANT');
});

test('tenancy: cross-tenant ids return 404 and list responses never mix organizations', async ({
  request,
}) => {
  const acmeOwner = await login(request, 'owner@acme.test');
  const nimbusOwner = await login(request, 'owner@nimbus.test');
  const acmeAuth = headers(acmeOwner, orgId(acmeOwner, 'Acme'));
  const nimbusAuth = headers(nimbusOwner, orgId(nimbusOwner, 'Nimbus'));

  const collections = [
    { path: '/invoices', key: 'invoices' },
    { path: '/bills', key: 'bills' },
    { path: '/bank-transactions', key: 'transactions' },
  ] as const;

  for (const collection of collections) {
    const acmeIds = await listIds(request, acmeAuth, collection.path, collection.key);
    const nimbusIds = await listIds(request, nimbusAuth, collection.path, collection.key);

    expect(acmeIds.length, `acme ${collection.path} seed`).toBeGreaterThan(0);
    expect(nimbusIds.length, `nimbus ${collection.path} seed`).toBeGreaterThan(0);
    expect(acmeIds.filter((id) => nimbusIds.includes(id))).toEqual([]);

    const acmeReadsNimbus = await request.get(
      `${API}${collection.path}/${nimbusIds[0]}`,
      { headers: acmeAuth },
    );
    expect(acmeReadsNimbus.status()).toBe(404);

    const nimbusReadsAcme = await request.get(
      `${API}${collection.path}/${acmeIds[0]}`,
      { headers: nimbusAuth },
    );
    expect(nimbusReadsAcme.status()).toBe(404);
  }
});

test('rbac: viewer reads invoices and accounts but cannot create either', async ({
  request,
}) => {
  const viewer = await login(request, 'viewer@acme.test');
  const auth = headers(viewer, orgId(viewer, 'Acme'));

  expect((await request.get(`${API}/invoices`, { headers: auth })).status()).toBe(200);
  expect((await request.get(`${API}/accounts`, { headers: auth })).status()).toBe(200);

  const invoiceIdsBefore = await listIds(request, auth, '/invoices', 'invoices');
  const accountIdsBefore = await listIds(request, auth, '/accounts', 'accounts');
  const customerId = await firstId(request, auth, '/customers', 'customers');
  const itemId = await firstId(request, auth, '/items', 'items');

  const deniedInvoice = await request.post(`${API}/invoices`, {
    headers: auth,
    data: {
      customerId,
      issueDate: '2026-11-17',
      dueDate: '2026-12-17',
      lines: [{ itemId, quantity: 1 }],
    },
  });
  expect(deniedInvoice.status()).toBe(403);

  const deniedAccount = await request.post(`${API}/accounts`, {
    headers: auth,
    data: { code: '9999', name: 'Viewer denied', type: 'EXPENSE' },
  });
  expect(deniedAccount.status()).toBe(403);

  expect(await listIds(request, auth, '/invoices', 'invoices')).toEqual(invoiceIdsBefore);
  expect(await listIds(request, auth, '/accounts', 'accounts')).toEqual(accountIdsBefore);
});

test('rbac: staff cannot manage accounts, members, approvals, or policies', async ({
  request,
}) => {
  const staff = await login(request, 'staff@acme.test');
  const auth = headers(staff, orgId(staff, 'Acme'));

  expect((await request.get(`${API}/accounts`, { headers: auth })).status()).toBe(200);
  const accountIdsBefore = await listIds(request, auth, '/accounts', 'accounts');

  expect(
    (
      await request.post(`${API}/accounts`, {
        headers: auth,
        data: { code: '9999', name: 'Staff denied', type: 'EXPENSE' },
      })
    ).status(),
  ).toBe(403);

  expect(
    (
      await request.post(`${API}/memberships`, {
        headers: auth,
        data: { email: 'staff@acme.test', role: 'STAFF' },
      })
    ).status(),
  ).toBe(403);

  expect(
    (
      await request.post(`${API}/agent/approvals/does-not-exist/approve`, {
        headers: auth,
      })
    ).status(),
  ).toBe(403);

  expect(
    (
      await request.patch(`${API}/agent/policies/invoice.create`, {
        headers: auth,
        data: { policy: 'auto' },
      })
    ).status(),
  ).toBe(403);

  expect(await listIds(request, auth, '/accounts', 'accounts')).toEqual(accountIdsBefore);
});

test('rbac: accountant manages accounts but cannot manage members, approvals, or policies', async ({
  request,
}) => {
  const accountant = await login(request, 'accountant@acme.test');
  const auth = headers(accountant, orgId(accountant, 'Acme'));

  const accountsRes = await request.get(`${API}/accounts`, { headers: auth });
  expect(accountsRes.ok()).toBeTruthy();
  const accounts = ((await accountsRes.json()) as { accounts: Array<{ id: string; code: string }> })
    .accounts;
  expect(accounts.length).toBeGreaterThan(0);
  const accountIdsBefore = accounts.map((account) => account.id);

  const duplicate = await request.post(`${API}/accounts`, {
    headers: auth,
    data: { code: accounts[0].code, name: 'Duplicate code', type: 'EXPENSE' },
  });
  expect(duplicate.status()).toBe(409);

  expect(await listIds(request, auth, '/accounts', 'accounts')).toEqual(accountIdsBefore);

  expect(
    (
      await request.post(`${API}/memberships`, {
        headers: auth,
        data: { email: 'accountant@acme.test', role: 'STAFF' },
      })
    ).status(),
  ).toBe(403);

  expect(
    (
      await request.post(`${API}/agent/approvals/does-not-exist/approve`, {
        headers: auth,
      })
    ).status(),
  ).toBe(403);

  expect(
    (
      await request.patch(`${API}/agent/policies/invoice.create`, {
        headers: auth,
        data: { policy: 'auto' },
      })
    ).status(),
  ).toBe(403);
});

test('rbac: owner keeps approval and policy access without creating records', async ({
  request,
}) => {
  const owner = await login(request, 'owner@acme.test');
  const auth = headers(owner, orgId(owner, 'Acme'));

  const policies = await request.get(`${API}/agent/policies`, { headers: auth });
  expect(policies.ok()).toBeTruthy();
  const policyRows = ((await policies.json()) as {
    policies: Array<{ toolName: string; policy: string }>;
  }).policies;
  expect(policyRows.some((row) => row.toolName === 'invoice.create')).toBeTruthy();

  expect(
    (
      await request.post(`${API}/agent/approvals/does-not-exist/approve`, {
        headers: auth,
      })
    ).status(),
  ).toBe(404);

  const accountsRes = await request.get(`${API}/accounts`, { headers: auth });
  const accounts = ((await accountsRes.json()) as { accounts: Array<{ code: string }> })
    .accounts;
  const accountIdsBefore = await listIds(request, auth, '/accounts', 'accounts');
  expect(
    (
      await request.post(`${API}/accounts`, {
        headers: auth,
        data: { code: accounts[0].code, name: 'Duplicate code', type: 'EXPENSE' },
      })
    ).status(),
  ).toBe(409);

  expect(
    (
      await request.post(`${API}/memberships`, {
        headers: auth,
        data: { email: 'accountant@acme.test', role: 'STAFF' },
      })
    ).status(),
  ).toBe(409);

  expect(await listIds(request, auth, '/accounts', 'accounts')).toEqual(accountIdsBefore);
});
