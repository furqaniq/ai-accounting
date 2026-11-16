import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'BILL' AND ` +
    `("sourceId" IN (SELECT b.id FROM "Bill" b JOIN "Vendor" v ON v.id = b."vendorId" ` +
    `WHERE v.name LIKE 'E2E Vendor%') OR memo LIKE 'Bill BILL-% — E2E Vendor%'); ` +
    `DELETE FROM "Bill" WHERE "vendorId" IN (SELECT id FROM "Vendor" WHERE name LIKE 'E2E Vendor%') ` +
    `OR notes LIKE 'E2E bill%'; ` +
    `DELETE FROM "Vendor" WHERE name LIKE 'E2E Vendor%';`;
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

test.beforeAll(() => {
  cleanTestRows();
});

test.afterAll(() => {
  cleanTestRows();
});

test('staff creates a vendor, drafts a bill, opens it, and sees the payable balance', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Vendors' }).click();
  await expect(page).toHaveURL(/\/vendors$/);
  await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible();

  await page.getByRole('button', { name: 'New vendor' }).click();
  const vendorForm = page.locator('#vendor-form');
  await vendorForm.getByLabel('Name', { exact: true }).fill('E2E Vendor Supply');
  await vendorForm.getByLabel('Contact name').fill('Erin Vendor');
  await vendorForm.getByLabel('Email').fill('pay@e2e-vendor.test');
  await vendorForm.getByRole('button', { name: 'Add vendor' }).click();
  await expect(page.getByRole('cell', { name: 'E2E Vendor Supply' })).toBeVisible();

  await page.getByRole('link', { name: 'Bills', exact: true }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByRole('heading', { name: 'Bills' })).toBeVisible();

  await page.getByRole('button', { name: 'New bill' }).click();
  const billForm = page.locator('#bill-form');
  await billForm.getByLabel('Vendor').selectOption({ label: 'E2E Vendor Supply' });
  await billForm.getByLabel('Issue date').fill('2026-11-01');
  await billForm.getByLabel('Due date').fill('2026-12-01');
  await billForm.getByLabel('Tax rate (%)').fill('0');
  await billForm.getByLabel('Line 1 description').fill('E2E bill supplies');
  await billForm
    .getByLabel('Line 1 expense account')
    .selectOption({ label: '6200 · Supplies expense' });
  await billForm.getByLabel('Line 1 quantity').fill('2');
  await billForm.getByLabel('Line 1 rate').fill('125');
  await billForm.getByLabel('Line 1 expense account').press('Tab');
  await expect(billForm).toContainText('$250.00');
  await billForm.getByRole('button', { name: 'Create draft' }).click();

  const detail = page.locator('#bill-detail');
  await expect(detail.getByRole('heading', { name: /Bill BILL-\d{4}/ })).toBeVisible();
  await expect(detail).toContainText('Draft');
  await expect(detail).toContainText('E2E Vendor Supply');
  await expect(detail).toContainText('$250.00');

  await detail.getByRole('button', { name: 'Open bill' }).click();
  await expect(detail).toContainText('Open');
  await expect(detail).toContainText('Balance due $250.00.');

  await page.getByRole('link', { name: 'Vendors' }).click();
  await page.getByLabel('Search vendors').fill('E2E Vendor Supply');
  const vendorRow = page.locator('.vendors-table tbody tr').filter({ hasText: 'E2E Vendor Supply' });
  await expect(vendorRow).toContainText('$250.00');
});
