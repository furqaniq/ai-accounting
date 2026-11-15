import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'PAYMENT' AND "sourceId" IN ` +
    `(SELECT id FROM "BillPayment" WHERE notes LIKE 'E2E bill payment%'); ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'BILL' AND "sourceId" IN ` +
    `(SELECT id FROM "Bill" WHERE notes LIKE 'E2E bill payment%'); ` +
    `DELETE FROM "BillPaymentApplication" WHERE "billPaymentId" IN ` +
    `(SELECT id FROM "BillPayment" WHERE notes LIKE 'E2E bill payment%'); ` +
    `DELETE FROM "BillPayment" WHERE notes LIKE 'E2E bill payment%'; ` +
    `DELETE FROM "Bill" WHERE notes LIKE 'E2E bill payment%';`;
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

interface ApiSession {
  token: string;
  orgId: string;
  headers: Record<string, string>;
}

async function apiSession(request: APIRequestContext): Promise<ApiSession> {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'staff@acme.test', password: 'Passw0rd!2026' },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const meRes = await request.get(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  const me = await meRes.json();
  const orgId = me.memberships.find(
    (membership: { organizationName: string }) =>
      membership.organizationName === 'Acme Services Co.',
  ).organizationId;
  return {
    token: session.accessToken,
    orgId,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Organization-Id': orgId,
      'Content-Type': 'application/json',
    },
  };
}

async function createOpenBill(
  request: APIRequestContext,
  session: ApiSession,
  notes: string,
  quantity: number,
  dueDate: string,
  vendorId: string,
  expenseAccountId: string,
): Promise<{ id: string; number: string }> {
  const res = await request.post(`${API}/bills`, {
    headers: session.headers,
    data: {
      vendorId,
      issueDate: '2026-11-01',
      dueDate,
      notes,
      taxRate: 0,
      lines: [{ description: notes, expenseAccountId, quantity, unitPrice: 100 }],
    },
  });
  expect(res.status()).toBe(201);
  const bill = await res.json();
  const opened = await request.post(`${API}/bills/${bill.id}/open`, {
    headers: session.headers,
  });
  expect(opened.status()).toBe(201);
  return { id: bill.id, number: bill.number };
}

test.beforeAll(() => {
  cleanTestRows();
});

test.afterAll(() => {
  cleanTestRows();
});

test('staff pays two bills in one run, updates AP aging, and posts one payables journal', async ({
  page,
  request,
}) => {
  const session = await apiSession(request);
  const vendors = await (await request.get(`${API}/vendors`, { headers: session.headers })).json();
  const vendorId = vendors.vendors.find(
    (vendor: { name: string }) => vendor.name === 'Brightline Utilities',
  ).id;
  const accounts = await (await request.get(`${API}/accounts`, { headers: session.headers })).json();
  const expenseAccountId = accounts.accounts.find(
    (account: { code: string }) => account.code === '6200',
  ).id;
  const billA = await createOpenBill(
    request,
    session,
    'E2E bill payment A',
    2,
    '2026-11-10',
    vendorId,
    expenseAccountId,
  );
  const billB = await createOpenBill(
    request,
    session,
    'E2E bill payment B',
    3,
    '2026-12-01',
    vendorId,
    expenseAccountId,
  );

  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole('link', { name: 'AP aging' }).click();
  await expect(page).toHaveURL(/\/reports\/ap-aging$/);
  await expect(page.getByRole('heading', { name: 'AP aging' })).toBeVisible();
  await page.getByLabel('As of date').fill('2026-11-15');
  await page
    .getByRole('button', { name: 'View Brightline Utilities Current bills' })
    .click();
  const drill = page.locator('#aging-drill');
  await expect(drill.getByRole('heading', { name: 'Brightline Utilities · Current' })).toBeVisible();
  await drill.getByRole('link', { name: billB.number }).click();
  await expect(page).toHaveURL(new RegExp(`/bills\\?bill=${billB.id}`));
  await expect(page.getByRole('heading', { name: `Bill ${billB.number}` })).toBeVisible();
  await page
    .locator('#bill-detail')
    .getByRole('link', { name: 'Record payment' })
    .click();
  await expect(page).toHaveURL(/\/bill-payments\?bill=/);

  const form = page.locator('#bill-payment-form');
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Vendor', { exact: true })).toHaveValue(vendorId);
  await expect(form.getByLabel(`Apply ${billB.number}`)).toBeChecked();
  await form.getByLabel('Payment date').fill('2026-11-15');
  await form.getByLabel('Method').selectOption({ label: 'Bank transfer' });
  await form.getByLabel('Reference').fill('E2E bill payment ref');
  await form.getByLabel('Notes').fill('E2E bill payment receipt');

  await form.getByLabel(`Apply ${billA.number}`).check();
  await form.getByLabel(`Amount for ${billB.number}`).fill('150');
  await expect(form.locator('#bill-payment-total')).toContainText('$350.00');

  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form).toBeHidden();

  const detail = page.locator('#bill-payment-detail');
  await expect(detail).toBeVisible();
  const paymentNumber = (await detail.locator('#bill-payment-detail-number').innerText())
    .replace('Bill payment ', '')
    .trim();
  expect(paymentNumber).toMatch(/^BPAY-\d{4}$/);
  await expect(detail).toContainText('$350.00 paid to Brightline Utilities.');
  await expect(
    detail.locator('tbody tr', { hasText: billA.number }).getByText('Paid'),
  ).toBeVisible();
  await expect(
    detail.locator('tbody tr', { hasText: billB.number }).getByText('Partial'),
  ).toBeVisible();
  await expect(detail.locator('tbody tr', { hasText: billB.number })).toContainText('$150.00');
  await expect(detail.locator('.invoice-total')).toContainText('$350.00');

  await page.getByRole('link', { name: 'Bills', exact: true }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await page.getByLabel('Search bills').fill(billA.number);
  const paidRow = page.locator('.bill-table tbody tr', { hasText: billA.number });
  await expect(paidRow.getByText('Paid', { exact: true })).toBeVisible();
  await expect(paidRow.getByText('$0.00').first()).toBeVisible();

  await page.getByLabel('Search bills').fill(billB.number);
  const partialRow = page.locator('.bill-table tbody tr', { hasText: billB.number });
  await expect(partialRow.getByText('Partial', { exact: true })).toBeVisible();
  await expect(partialRow.getByText('$150.00').first()).toBeVisible();

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  const journalRow = page.locator('.journal-table tbody tr', {
    hasText: `Bill payment ${paymentNumber} — Brightline Utilities`,
  });
  await expect(journalRow).toBeVisible();
  await expect(journalRow.getByText('Payment', { exact: true })).toBeVisible();
  await expect(journalRow.getByText('$350.00')).toBeVisible();

  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByRole('link', { name: 'AP aging' }).click();
  await page.getByLabel('As of date').fill('2026-11-15');
  await expect(
    page.getByRole('button', { name: 'View Brightline Utilities Current bills' }),
  ).toHaveText('$150.00');
  await expect(
    page.getByRole('button', { name: 'View Brightline Utilities 31–60 bills' }),
  ).toHaveText('$475.00');
});
