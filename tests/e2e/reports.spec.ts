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
  await expect(page.getByRole('heading', { name: 'Financial statements' })).toBeVisible();
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
