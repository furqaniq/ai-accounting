import { APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

async function accountantSession(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'accountant@acme.test', password: 'Passw0rd!2026' },
  });
  const session = (await login.json()) as {
    accessToken: string;
    memberships: { organizationId: string; organizationName: string }[];
  };
  const acme = session.memberships.find((m) => m.organizationName.startsWith('Acme'));
  return { token: session.accessToken, organizationId: acme?.organizationId ?? '' };
}

async function resetTestAccount(request: APIRequestContext) {
  const { token, organizationId } = await accountantSession(request);
  const headers = { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId };
  const res = await request.get(`${API}/accounts`, { headers });
  const body = (await res.json()) as {
    accounts: { id: string; code: string }[];
  };
  const existing = body.accounts.find((a) => a.code === '6560');
  if (existing) {
    await request.patch(`${API}/accounts/${existing.id}`, {
      headers,
      data: { name: 'Travel expense', subtype: 'General expense', active: true },
    });
  }
  return { token, organizationId, headers, existing };
}

test('accountant manages the chart of accounts and history stays visible', async ({
  page,
  request,
}) => {
  const { existing } = await resetTestAccount(request);

  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();

  const table = page.locator('.accounts-table');
  await expect(table.getByText('Cash', { exact: true })).toBeVisible();
  await expect(table.getByText('1000', { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ accounts, \d+ active/)).toBeVisible();

  if (!existing) {
    await page.getByRole('button', { name: 'New account' }).click();
    const form = page.locator('#account-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Code').fill('6560');
    await form.getByLabel('Name').fill('Travel expense');
    await form.getByLabel('Type', { exact: true }).selectOption('EXPENSE');
    await form.getByLabel('Subtype', { exact: true }).selectOption('General expense');
    await form.getByRole('button', { name: 'Add account' }).click();
    await expect(form).toBeHidden();
  }

  const row = table.locator('tr', { hasText: 'Travel expense' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Expenses', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Travel expense' }).click();
  await page.locator('#account-form').getByLabel('Name').fill('Travel and meals');
  await page.locator('#account-form').getByRole('button', { name: 'Save account' }).click();
  await expect(table.getByText('Travel and meals', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Travel and meals' }).click();
  await page.locator('#account-form').getByLabel('Account is active').uncheck();
  await page.locator('#account-form').getByRole('button', { name: 'Save account' }).click();
  await expect(table.getByText('Inactive', { exact: true })).toBeVisible();

  await page.getByLabel('Show inactive').uncheck();
  await expect(table.getByText('Travel and meals', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show inactive').check();
  await expect(table.getByText('Travel and meals', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(table.getByText('Travel and meals', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(table.getByText('Travel and meals', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/$/);
});
