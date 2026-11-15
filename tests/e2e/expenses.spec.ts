import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" j WHERE j."sourceType" = 'REVERSAL' AND EXISTS (` +
    `SELECT 1 FROM "JournalEntry" orig JOIN "Expense" e ON orig."sourceId" LIKE e.id || '%' ` +
    `WHERE orig.id = j."sourceId" AND e.memo LIKE 'E2E expense%'); ` +
    `DELETE FROM "JournalEntry" j WHERE j."sourceType" = 'EXPENSE' AND EXISTS (` +
    `SELECT 1 FROM "Expense" e WHERE e.memo LIKE 'E2E expense%' AND j."sourceId" LIKE e.id || '%'); ` +
    `DELETE FROM "Expense" WHERE memo LIKE 'E2E expense%';`;
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

test('staff records a quick expense, sees the total, and corrects it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New expense' }).click();
  const form = page.locator('#expense-form');
  await form.getByLabel('Date').fill('2026-11-12');
  await form.getByLabel('Vendor').selectOption({ label: 'Brightline Utilities' });
  await form.getByLabel('Category').selectOption({ label: '6200 · Supplies expense' });
  await form.getByLabel('Amount').fill('87.65');
  await form.getByLabel('Memo').fill('E2E expense printer paper');
  await form.getByLabel('Receipt note').fill('e2e-receipt.jpg');
  await form.getByRole('button', { name: 'Record expense' }).click();

  const detail = page.locator('#expense-detail');
  await expect(detail.getByRole('heading', { name: /Expense EXP-\d{4}/ })).toBeVisible();
  await expect(detail).toContainText('Brightline Utilities');
  await expect(detail).toContainText('6200 · Supplies expense');
  await expect(detail).toContainText('$87.65');
  await expect(detail).toContainText('E2E expense printer paper');
  await expect(detail).toContainText('e2e-receipt.jpg');

  await page.getByLabel('Search expenses').fill('E2E expense printer paper');
  const table = page.locator('.expense-table');
  await expect(table.getByRole('cell', { name: 'E2E expense printer paper' })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Brightline Utilities' })).toBeVisible();
  await expect(table.locator('tbody').getByRole('cell', { name: '$87.65' })).toBeVisible();
  await expect(table.locator('tfoot')).toContainText('$87.65');

  await detail.getByRole('button', { name: 'Edit expense' }).click();
  await form.getByLabel('Amount').fill('97.65');
  await form.getByLabel('Memo').fill('E2E expense printer paper corrected');
  await form.getByRole('button', { name: 'Save expense' }).click();

  await expect(detail).toContainText('$97.65');
  await expect(detail).toContainText('corrected 1×');
  await expect(detail).toContainText('E2E expense printer paper corrected');
  await expect(table.locator('tfoot')).toContainText('$97.65');
});
