import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

function runSql(sql: string): void {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

function cleanTestRows(): void {
  const accountIds = `SELECT id FROM "BankAccount" WHERE name LIKE 'E2E Match Bank%'`;
  const transactionIds =
    `SELECT id FROM "BankTransaction" WHERE "bankAccountId" IN (${accountIds})`;
  const invoiceIds = `SELECT id FROM "Invoice" WHERE notes LIKE 'E2E match%'`;
  const paymentIds = `SELECT id FROM "Payment" WHERE notes LIKE 'E2E match%'`;
  const expenseIds = `SELECT id FROM "Expense" WHERE memo LIKE 'E2E match%'`;
  const billIds = `SELECT id FROM "Bill" WHERE notes LIKE 'E2E match%'`;
  const journalWhere =
    `("sourceType" = 'BANK' AND "sourceId" IN (${transactionIds})) OR ` +
    `("sourceType" = 'INVOICE' AND "sourceId" IN (${invoiceIds})) OR ` +
    `("sourceType" = 'PAYMENT' AND "sourceId" IN (${paymentIds})) OR ` +
    `("sourceType" = 'EXPENSE' AND "sourceId" IN (${expenseIds})) OR ` +
    `("sourceType" = 'BILL' AND "sourceId" IN (${billIds}))`;
  const sql =
    `DELETE FROM "JournalLine" WHERE "entryId" IN (` +
    `SELECT id FROM "JournalEntry" WHERE ${journalWhere}); ` +
    `DELETE FROM "JournalEntry" WHERE ${journalWhere}; ` +
    `DELETE FROM "BankTransaction" WHERE "bankAccountId" IN (${accountIds}); ` +
    `DELETE FROM "BankImportBatch" WHERE "bankAccountId" IN (${accountIds}); ` +
    `DELETE FROM "BankAccount" WHERE id IN (${accountIds}); ` +
    `DELETE FROM "Payment" WHERE id IN (${paymentIds}); ` +
    `DELETE FROM "Expense" WHERE id IN (${expenseIds}); ` +
    `DELETE FROM "Invoice" WHERE id IN (${invoiceIds}); ` +
    `DELETE FROM "Bill" WHERE id IN (${billIds});`;
  runSql(sql);
}

interface Session {
  token: string;
  orgId: string;
  headers: Record<string, string>;
}

async function apiSession(request: APIRequestContext): Promise<Session> {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'staff@acme.test', password: 'Passw0rd!2026' },
  });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  const meRes = await request.get(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${body.accessToken}` },
  });
  const me = await meRes.json();
  const orgId = me.memberships.find(
    (membership: { organizationName: string }) =>
      membership.organizationName === 'Acme Services Co.',
  ).organizationId;
  return {
    token: body.accessToken,
    orgId,
    headers: {
      Authorization: `Bearer ${body.accessToken}`,
      'X-Organization-Id': orgId,
      'Content-Type': 'application/json',
    },
  };
}

async function createSentInvoice(
  request: APIRequestContext,
  session: Session,
  input: {
    customerId: string;
    itemId: string;
    amount: number;
    dueDate: string;
    notes: string;
  },
): Promise<{ id: string; number: string }> {
  const res = await request.post(`${API}/invoices`, {
    headers: session.headers,
    data: {
      customerId: input.customerId,
      issueDate: '2026-11-20',
      dueDate: input.dueDate,
      taxRate: 0,
      notes: input.notes,
      lines: [{ itemId: input.itemId, quantity: 1, unitPrice: input.amount }],
    },
  });
  expect(res.status()).toBe(201);
  const invoice = await res.json();
  const sent = await request.post(`${API}/invoices/${invoice.id}/send`, {
    headers: session.headers,
  });
  expect(sent.status()).toBe(201);
  return invoice;
}

test.beforeAll(() => {
  cleanTestRows();
});

test.afterAll(() => {
  cleanTestRows();
});

test('staff matches imported activity to an invoice, bill, payment, and expense', async ({
  page,
  request,
}) => {
  const session = await apiSession(request);
  const customers = await (
    await request.get(`${API}/customers`, { headers: session.headers })
  ).json();
  const customerId = customers.customers.find(
    (customer: { name: string }) => customer.name === 'Northwind Studio',
  ).id;
  const items = await (
    await request.get(`${API}/items`, { headers: session.headers })
  ).json();
  const itemId = items.items.find(
    (item: { name: string }) => item.name === 'Consulting hour',
  ).id;
  const vendors = await (
    await request.get(`${API}/vendors`, { headers: session.headers })
  ).json();
  const vendorId = vendors.vendors.find(
    (vendor: { name: string }) => vendor.name === 'Brightline Utilities',
  ).id;
  const accounts = await (
    await request.get(`${API}/accounts`, { headers: session.headers })
  ).json();
  const suppliesAccountId = accounts.accounts.find(
    (account: { code: string }) => account.code === '6200',
  ).id;

  const invoice = await createSentInvoice(request, session, {
    customerId,
    itemId,
    amount: 321,
    dueDate: '2026-12-10',
    notes: 'E2E match invoice',
  });

  const billRes = await request.post(`${API}/bills`, {
    headers: session.headers,
    data: {
      vendorId,
      issueDate: '2026-11-20',
      dueDate: '2026-12-11',
      taxRate: 0,
      notes: 'E2E match bill',
      lines: [
        {
          description: 'E2E match utilities',
          expenseAccountId: suppliesAccountId,
          quantity: 1,
          unitPrice: 432,
        },
      ],
    },
  });
  expect(billRes.status()).toBe(201);
  const bill = await billRes.json();
  const openedBill = await request.post(`${API}/bills/${bill.id}/open`, {
    headers: session.headers,
  });
  expect(openedBill.status()).toBe(201);

  const paymentInvoice = await createSentInvoice(request, session, {
    customerId,
    itemId,
    amount: 543,
    dueDate: '2026-12-12',
    notes: 'E2E match payment invoice',
  });
  const paymentRes = await request.post(`${API}/payments`, {
    headers: session.headers,
    data: {
      customerId,
      date: '2026-12-12',
      amount: 543,
      method: 'BANK_TRANSFER',
      reference: 'E2E match receipt',
      notes: 'E2E match payment',
      applications: [{ invoiceId: paymentInvoice.id, amount: 543 }],
    },
  });
  expect(paymentRes.status()).toBe(201);
  const payment = await paymentRes.json();

  const expenseRes = await request.post(`${API}/expenses`, {
    headers: session.headers,
    data: {
      date: '2026-12-13',
      amount: 654,
      categoryAccountId: suppliesAccountId,
      memo: 'E2E match office expense',
    },
  });
  expect(expenseRes.status()).toBe(201);
  const expense = await expenseRes.json();

  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Banking', exact: true }).click();
  await expect(page).toHaveURL(/\/banking$/);

  await page.getByRole('button', { name: 'New bank account' }).click();
  const accountForm = page.locator('#bank-account-form');
  await accountForm.getByLabel('Account name').fill('E2E Match Bank Checking');
  await accountForm.getByLabel('Type').selectOption({ label: 'Checking' });
  await accountForm.getByLabel('Ledger account').selectOption({ label: '1000 · Cash' });
  await accountForm.getByRole('button', { name: 'Add bank account' }).click();
  await expect(accountForm).toBeHidden();

  const importForm = page.locator('#bank-import-form');
  const fixture = join(process.cwd(), 'tests/e2e/fixtures/bank-matching.csv');
  await page.getByRole('button', { name: 'Import transactions' }).click();
  await importForm.getByLabel('Bank file').setInputFiles(fixture);
  await importForm.getByRole('button', { name: 'Preview import' }).click();
  await expect(importForm.locator('.bank-import-preview')).toContainText('4 new');
  await importForm
    .locator('.bank-import-preview')
    .getByRole('button', { name: 'Import transactions' })
    .click();
  await expect(page.getByText('Imported 4 transactions.')).toBeVisible();

  const table = page.locator('.bank-transaction-table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  const drawer = page.locator('#bank-resolve-form');

  const matches = [
    {
      description: 'NORTHWIND INVOICE PAYMENT',
      number: invoice.number,
      type: 'Invoice',
    },
    {
      description: 'BRIGHTLINE UTILITIES BILL',
      number: bill.number,
      type: 'Bill',
    },
    {
      description: 'NORTHWIND CUSTOMER PAYMENT',
      number: payment.number,
      type: 'Payment',
    },
    {
      description: 'E2E MATCH OFFICE EXPENSE',
      number: expense.number,
      type: 'Expense',
    },
  ];

  for (const match of matches) {
    const row = table.locator('tbody tr').filter({ hasText: match.description });
    await row.getByRole('button', { name: /Resolve/ }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('tab', { name: 'Match existing' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(drawer.locator('.bank-match-card').first()).toBeVisible();
    const candidate = drawer.locator('.bank-match-card').filter({ hasText: match.number });
    await expect(candidate).toContainText(match.type);
    await candidate.click();
    await expect(candidate.locator('input')).toBeChecked();
    await drawer.getByRole('button', { name: 'Match transaction' }).click();
    await expect(drawer).toBeHidden();
    await expect(row).toContainText('Matched');
    await expect(row).toContainText(match.number);
    await expect(row.getByRole('button', { name: /Resolve/ })).toHaveCount(0);
  }

  await page.getByLabel('Filter transactions by match state').selectOption({ label: 'Matched' });
  await expect(table.locator('tbody tr')).toHaveCount(4);
});
