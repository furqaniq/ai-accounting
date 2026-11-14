import { APIRequestContext, expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const ORIGINAL = {
  name: 'Acme Services Co.',
  fiscalYearStartMonth: 1,
  fiscalYearStartDay: 1,
  baseCurrency: 'USD',
  defaultTaxRate: 0,
};

async function acmeSession(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'owner@acme.test', password: 'Passw0rd!2026' },
  });
  const session = (await login.json()) as {
    accessToken: string;
    memberships: { organizationId: string; organizationName: string }[];
  };
  const acme = session.memberships.find(
    (m) => m.organizationName.startsWith('Acme Services'),
  );
  return { token: session.accessToken, organizationId: acme?.organizationId ?? '' };
}

async function restore(request: APIRequestContext) {
  const { token, organizationId } = await acmeSession(request);
  if (!organizationId) return;
  await request.patch(`${API}/organizations/settings`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId },
    data: ORIGINAL,
  });
}

test('organization settings changes appear in the audit log', async ({ page, request }) => {
  await restore(request);

  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@acme.test');
    await page.getByLabel('Password').fill('Passw0rd!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.getByRole('button', { name: /Acme Services Co\./ }).click();
    await page.locator('#org-menu').getByRole('button', { name: /Settings/ }).click();

    const settings = page.locator('#settings');
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel('Organization name')).toHaveValue('Acme Services Co.');

    await settings.getByLabel('Organization name').fill('Acme Services Co. Test');
    await settings.getByLabel('Fiscal year start month').selectOption('4');
    await settings.getByLabel('Fiscal year start day').fill('6');
    await settings.getByLabel('Base currency').fill('CAD');
    await settings.getByLabel('Default tax rate (%)').fill('7.5');
    await settings.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.locator('#toast')).toContainText('Settings saved');
    await expect(page.getByRole('button', { name: /Acme Services Co\. Test/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Acme Services Co\. Test/ }).click();
    await page.locator('#org-menu').getByRole('button', { name: /Audit log/ }).click();

    const audit = page.locator('#audit-log');
    await expect(audit).toBeVisible();
    await audit.getByLabel('Filter by action').selectOption('org.settings.update');
    await expect(audit.locator('.audit-row__action').first()).toHaveText('Settings updated');
    await expect(
      audit.locator('.audit-row__detail').first(),
    ).toContainText('Name: Acme Services Co. → Acme Services Co. Test');
    await expect(audit.locator('.audit-row__actor').first()).toHaveText('owner@acme.test');

    await audit.getByLabel('Filter by action').selectOption('');
    await audit.getByLabel('Filter by record').selectOption('OrgMembership');
    await expect(audit.locator('.audit-row').first()).toBeVisible();
    const memberActions = await audit.locator('.audit-row__action').allTextContents();
    expect(memberActions.length).toBeGreaterThan(0);
    for (const label of memberActions) {
      expect(['Member added', 'Role changed', 'Member removed']).toContain(label);
    }

    await page.keyboard.press('Escape');
    await expect(audit).toBeHidden();
  } finally {
    await restore(request);
  }
});
