import { APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

async function removeIfPresent(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  email: string,
) {
  const res = await request.get(`${API}/memberships`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
  });
  const body = (await res.json()) as { memberships: { id: string; email: string }[] };
  const leftover = body.memberships.find((m) => m.email === email);
  if (leftover) {
    await request.delete(`${API}/memberships/${leftover.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
    });
  }
}

async function acmeClean(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'owner@acme.test', password: 'Passw0rd!2026' },
  });
  const session = (await login.json()) as {
    accessToken: string;
    memberships: { organizationId: string; organizationName: string }[];
  };
  const acme = session.memberships.find((m) => m.organizationName === 'Acme Services Co.');
  if (acme) {
    await removeIfPresent(request, session.accessToken, acme.organizationId, 'owner@nimbus.test');
  }
}

test('an owner manages members and a viewer sees the register read-only', async ({
  page,
  request,
}) => {
  await acmeClean(request);
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: /Acme Services Co\./ }).click();
  await page.locator('#org-menu').getByRole('button', { name: /Members/ }).click();

  const drawer = page.locator('#members');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('accountant@acme.test', { exact: true })).toBeVisible();

  await drawer.getByLabel('Member email').fill('owner@nimbus.test');
  await drawer.getByLabel('Role', { exact: true }).selectOption('STAFF');
  await drawer.getByRole('button', { name: 'Add member' }).click();

  await expect(drawer.getByText('Noah Nimbus', { exact: true })).toBeVisible();

  await drawer.getByLabel('Role for Noah Nimbus').selectOption('VIEWER');
  await expect(drawer.getByLabel('Role for Noah Nimbus')).toHaveValue('VIEWER');

  await drawer.getByRole('button', { name: 'Remove Noah Nimbus' }).click();
  await expect(drawer.getByText('Noah Nimbus', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('owner@nimbus.test')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await page.getByRole('button', { name: /Sign out/ }).click();
  await page.getByLabel('Email').fill('viewer@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: /Acme Services Co\./ }).click();
  await page.locator('#org-menu').getByRole('button', { name: /Members/ }).click();

  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('accountant@acme.test', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Add member' })).toHaveCount(0);
  await expect(drawer.getByLabel('Role for Ada Accountant')).toHaveCount(0);
  await expect(drawer.getByText(/Only owners and admins/)).toBeVisible();
});
