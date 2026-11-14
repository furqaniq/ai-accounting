import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'PAYMENT' AND "sourceId" IN ` +
    `(SELECT id FROM "Payment" WHERE notes LIKE 'E2E payment%'); ` +
    `DELETE FROM "Payment" WHERE notes LIKE 'E2E payment%'; ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IN ` +
    `(SELECT id FROM "Invoice" WHERE notes LIKE 'E2E payment%'); ` +
    `DELETE FROM "Invoice" WHERE notes LIKE 'E2E payment%'; ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IS NOT NULL ` +
    `AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "JournalEntry"."sourceId"); ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'PAYMENT' AND "sourceId" IS NOT NULL ` +
    `AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p.id = "JournalEntry"."sourceId");`;
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

interface ApiSession {
  token: string;
  orgId: string;
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
    (membership: { organizationName: string }) => membership.organizationName === 'Acme Services Co.',
  ).organizationId;
  return { token: session.accessToken, orgId };
}

function apiHeaders(session: ApiSession): Record<string, string> {
  return {
    Authorization: `Bearer ${session.token}`,
    'X-Organization-Id': session.orgId,
    'Content-Type': 'application/json',
  };
}

async function createSentInvoice(
  request: APIRequestContext,
  session: ApiSession,
  notes: string,
  quantity: number,
  itemId: string,
  customerId: string,
): Promise<{ id: string; number: string; total: number }> {
  const res = await request.post(`${API}/invoices`, {
    headers: apiHeaders(session),
    data: {
      customerId,
      issueDate: '2026-11-01',
      dueDate: '2026-12-15',
      notes,
      lines: [{ itemId, quantity, unitPrice: 150 }],
    },
  });
  expect(res.status()).toBe(201);
  const invoice = await res.json();
  const sent = await request.post(`${API}/invoices/${invoice.id}/send`, {
    headers: apiHeaders(session),
  });
  expect(sent.status()).toBe(201);
  return { id: invoice.id, number: invoice.number, total: invoice.total };
}

test.beforeAll(() => {
  cleanTestRows();
});

test.afterAll(() => {
  cleanTestRows();
});

test('staff records one receipt across two invoices and closes the receivable loop', async ({
  page,
  request,
}) => {
  const session = await apiSession(request);
  const customers = await (
    await request.get(`${API}/customers`, { headers: apiHeaders(session) })
  ).json();
  const customerId = customers.customers.find(
    (customer: { name: string }) => customer.name === 'Northwind Studio',
  ).id;
  const items = await (
    await request.get(`${API}/items`, { headers: apiHeaders(session) })
  ).json();
  const itemId = items.items.find(
    (item: { name: string }) => item.name === 'Consulting hour',
  ).id;
  const invoiceA = await createSentInvoice(
    request,
    session,
    'E2E payment invoice A',
    2,
    itemId,
    customerId,
  );
  const invoiceB = await createSentInvoice(
    request,
    session,
    'E2E payment invoice B',
    3,
    itemId,
    customerId,
  );

  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Record payment' }).click();
  const form = page.locator('#payment-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Customer', { exact: true }).selectOption({ label: 'Northwind Studio' });
  await form.getByLabel('Payment date').fill('2026-11-15');
  await form.getByLabel('Method').selectOption({ label: 'Bank transfer' });
  await form.getByLabel('Reference').fill('E2E payment ref');
  await form.getByLabel('Notes').fill('E2E payment receipt');

  await form.getByLabel(`Apply ${invoiceA.number}`).check();
  await form.getByLabel(`Apply ${invoiceB.number}`).check();
  await form.getByLabel(`Amount for ${invoiceB.number}`).fill('200');
  await expect(form.locator('#payment-total')).toContainText('$500.00');

  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form).toBeHidden();

  const detail = page.locator('#payment-detail');
  await expect(detail).toBeVisible();
  const paymentNumber = (await detail.locator('#payment-detail-number').innerText())
    .replace('Payment ', '')
    .trim();
  expect(paymentNumber).toMatch(/^PAY-\d{4}$/);
  await expect(detail).toContainText('$500.00 received from Northwind Studio.');
  await expect(detail.locator('tbody tr', { hasText: invoiceA.number }).getByText('Paid')).toBeVisible();
  await expect(
    detail.locator('tbody tr', { hasText: invoiceB.number }).getByText('Partial'),
  ).toBeVisible();
  await expect(detail.locator('.invoice-total')).toContainText('$500.00');

  await page.getByRole('link', { name: 'Invoices', exact: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.getByLabel('Search invoices').fill(invoiceA.number);
  const paidRow = page.locator('.invoice-table tbody tr', { hasText: invoiceA.number });
  await expect(paidRow.getByText('Paid', { exact: true })).toBeVisible();
  await expect(paidRow.getByText('$0.00').first()).toBeVisible();

  await page.getByLabel('Search invoices').fill(invoiceB.number);
  const partialRow = page.locator('.invoice-table tbody tr', { hasText: invoiceB.number });
  await expect(partialRow.getByText('Partial', { exact: true })).toBeVisible();
  await expect(partialRow.getByText('$250.00').first()).toBeVisible();

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  const journalRow = page.locator('.journal-table tbody tr', {
    hasText: `Payment ${paymentNumber} — Northwind Studio`,
  });
  await expect(journalRow).toBeVisible();
  await expect(journalRow.getByText('Payment', { exact: true })).toBeVisible();
  await expect(journalRow.getByText('$500.00')).toBeVisible();

  await page.getByRole('link', { name: 'Payments' }).click();
  await page.getByLabel('Search payments').fill(paymentNumber);
  const paymentRow = page.locator('.payment-table tbody tr', { hasText: paymentNumber });
  await expect(paymentRow).toBeVisible();
  await expect(paymentRow.getByText('$500.00')).toBeVisible();
  await expect(paymentRow).toContainText(invoiceA.number);
  await expect(paymentRow).toContainText(invoiceB.number);
});
