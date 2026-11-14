import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "Item" WHERE name LIKE 'E2E %'; ` +
    `DELETE FROM "Customer" WHERE name LIKE 'E2E %';`;
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

test('staff manages customers and the item catalog', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByText('Northwind Studio')).toBeVisible();

  await page.getByRole('button', { name: 'New customer' }).click();
  const customerForm = page.locator('#customer-form');
  await expect(customerForm).toBeVisible();
  await customerForm.getByLabel('Name', { exact: true }).fill('E2E Customer');
  await customerForm.getByLabel('Contact name').fill('Eli Example');
  await customerForm.getByLabel('Email').fill('eli@e2e.test');
  await customerForm.getByLabel('Phone').fill('555-0155');
  await customerForm.getByLabel('City').fill('Denver');
  await customerForm.getByLabel('Region').fill('CO');
  await customerForm.getByLabel('Postal code').fill('80202');
  await customerForm.getByLabel('Country').fill('United States');
  await customerForm.getByLabel('Notes').fill('Net 30');
  await customerForm.getByRole('button', { name: 'Add customer' }).click();
  await expect(customerForm).toBeHidden();

  const customerRow = page.locator('.customers-table tbody tr', { hasText: 'E2E Customer' });
  await expect(customerRow).toBeVisible();
  await expect(customerRow.getByText('Eli Example')).toBeVisible();
  await expect(customerRow.getByText('$0.00')).toBeVisible();
  await expect(customerRow.locator('.accounts-code')).toHaveText(/^CUST-\d{4}$/);

  await customerRow.click();
  const detail = page.locator('#customer-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.detail-figure')).toHaveText('$0.00');
  await expect(detail.getByText('Eli Example')).toBeVisible();
  await expect(detail.getByText('Denver')).toBeVisible();

  await detail.getByRole('button', { name: 'Edit customer' }).click();
  await expect(detail).toBeHidden();
  await expect(customerForm).toBeVisible();
  await customerForm.getByLabel('Name', { exact: true }).fill('E2E Customer Updated');
  await customerForm.getByLabel('Contact name').fill('Eli Updated');
  await customerForm.getByRole('button', { name: 'Save customer' }).click();
  await expect(customerForm).toBeHidden();
  await expect(page.getByText('E2E Customer Updated').first()).toBeVisible();

  await page.getByLabel('Search customers').fill('E2E Customer Updated');
  await expect(page.getByText('E2E Customer Updated').first()).toBeVisible();
  await page.getByLabel('Search customers').fill('no-such-customer');
  await expect(page.getByText('No customers match this search.')).toBeVisible();
  await page.getByLabel('Search customers').fill('');

  await page.getByRole('link', { name: 'Items' }).click();
  await expect(page).toHaveURL(/\/items$/);
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
  await expect(page.getByText('Consulting hour')).toBeVisible();

  await page.getByRole('button', { name: 'New item' }).click();
  const itemForm = page.locator('#item-form');
  await expect(itemForm).toBeVisible();
  await itemForm.getByLabel('Name', { exact: true }).fill('E2E Item');
  await itemForm.getByLabel('Description').fill('E2E service');
  await itemForm.getByLabel('Price').fill('125');
  await itemForm.getByLabel('Income account').selectOption({ label: '4000 — Sales income' });
  await itemForm.getByLabel('Taxable').uncheck();
  await itemForm.getByRole('button', { name: 'Add item' }).click();
  await expect(itemForm).toBeHidden();

  const itemRow = page.locator('.items-table tbody tr', { hasText: 'E2E Item' });
  await expect(itemRow).toBeVisible();
  await expect(itemRow.getByText('$125.00')).toBeVisible();
  await expect(itemRow.getByText('No', { exact: true })).toBeVisible();
  await expect(itemRow.getByText('4000 — Sales income')).toBeVisible();
  await expect(itemRow.locator('.accounts-code')).toHaveText(/^ITEM-\d{4}$/);

  await page.getByRole('button', { name: 'Edit E2E Item' }).click();
  await expect(itemForm).toBeVisible();
  await itemForm.getByLabel('Price').fill('150');
  await itemForm.getByLabel('Taxable').check();
  await itemForm.getByRole('button', { name: 'Save item' }).click();
  await expect(itemForm).toBeHidden();
  await expect(itemRow.getByText('$150.00')).toBeVisible();
  await expect(itemRow.getByText('Yes', { exact: true })).toBeVisible();

  await page.getByLabel('Search items').fill('E2E Item');
  await expect(page.locator('.items-table tbody tr', { hasText: 'E2E Item' })).toBeVisible();
  await page.getByLabel('Search items').fill('no-such-item');
  await expect(page.getByText('No items match this search.')).toBeVisible();
});
