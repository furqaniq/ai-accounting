import { expect, test } from '@playwright/test';

test('accountant reads all four statements, changes periods, and drills into the register', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Profit & loss' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');
  const sheet = page.locator('.statement-sheet');
  await expect(sheet.locator('tbody')).toContainText('4000 — Sales income');
  await expect(sheet.locator('tbody')).toContainText('$1,200.00');
  await expect(sheet.locator('tbody')).toContainText('Total expenses');
  await expect(sheet.locator('tbody')).toContainText('$1,075.00');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('Net income');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$125.00');

  await page.getByRole('tab', { name: 'Balance sheet' }).click();
  await page.getByLabel('As of date').fill('2026-12-31');
  await expect(sheet.locator('tbody')).toContainText('Current earnings');
  await expect(sheet.locator('tbody')).toContainText('$6,323.75');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('Total liabilities and equity');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$6,323.75');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Cash flow' }).click();
  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');
  await expect(page.locator('.stat', { hasText: 'Beginning cash' })).toContainText('$0.00');
  await expect(page.locator('.stat', { hasText: 'Net change' })).toContainText('$5,000.00');
  await expect(page.locator('.stat', { hasText: 'Ending cash' })).toContainText('$5,000.00');
  await expect(sheet.locator('tbody')).toContainText('3000 — Owner equity');
  await expect(sheet.locator('tbody')).toContainText('$5,000.00');
  await expect(page.getByText('Reconciled', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Trial balance' }).click();
  await page.getByLabel('As of date').fill('2026-12-31');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$7,398.75');
  await expect(page.getByText('Debits equal credits', { exact: true })).toBeVisible();

  await sheet.getByRole('link', { name: '4000 — Sales income' }).click();
  await expect(page).toHaveURL(/\/ledger\?account=/);
  await expect(page.getByRole('heading', { name: 'General ledger' })).toBeVisible();
  await expect(page.getByLabel('Register account').locator('option:checked')).toHaveText(
    '4000 — Sales income',
  );
  await expect(page.getByLabel('Register to')).toHaveValue('2026-12-31');
});

test('accountant reads operational analysis and drills into a source invoice', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports$/);

  await page.getByRole('tab', { name: 'Sales by customer' }).click();
  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');

  const sheet = page.locator('.statement-sheet');
  await expect(sheet.getByRole('heading', { name: 'Sales by customer' })).toBeVisible();
  await expect(sheet.locator('tbody')).toContainText('CUST-0001 — Northwind Studio');
  await expect(sheet.locator('tbody')).toContainText('$300.00');
  await expect(sheet.locator('tbody')).toContainText('CUST-0002 — Harbor & Pine');
  await expect(sheet.locator('tbody')).toContainText('$900.00');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('Total sales');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$1,200.00');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$1,274.25');
  await expect(sheet.getByText('Reconciled', { exact: true })).toBeVisible();

  const northwind = sheet.locator('tbody tr', { hasText: 'Northwind Studio' });
  await northwind.getByRole('button', { name: '1 invoice' }).click();
  await expect(sheet.getByRole('link', { name: 'INV-1001' })).toBeVisible();
  await sheet.getByRole('link', { name: 'INV-1001' }).click();
  await expect(page).toHaveURL(/\/invoices\?invoice=/);
  await expect(page.getByRole('heading', { name: 'Invoice INV-1001' })).toBeVisible();

  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByRole('tab', { name: 'Sales by item' }).click();
  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');
  await expect(sheet.locator('tbody')).toContainText('ITEM-0001 — Consulting hour');
  await expect(sheet.locator('tbody')).toContainText('ITEM-0002 — Design package');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$1,200.00');

  await page.getByRole('tab', { name: 'Expenses by category' }).click();
  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');
  await expect(sheet.locator('tbody')).toContainText('6100 — Utilities expense');
  await expect(sheet.locator('tbody')).toContainText('$475.00');
  await expect(sheet.locator('tbody')).toContainText('6200 — Supplies expense');
  await expect(sheet.locator('tbody')).toContainText('$600.00');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('Total expenses');
  await expect(sheet.locator('tfoot tr.is-total')).toContainText('$1,075.00');

  const utilities = sheet.locator('tbody tr', { hasText: 'Utilities expense' });
  await utilities.getByRole('button', { name: '1 document' }).click();
  await expect(sheet.getByRole('link', { name: 'BILL-1002' })).toBeVisible();
});
