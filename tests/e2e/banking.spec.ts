import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "BankTransaction" WHERE "bankAccountId" IN (` +
    `SELECT id FROM "BankAccount" WHERE name LIKE 'E2E Bank%'); ` +
    `DELETE FROM "BankImportBatch" WHERE "bankAccountId" IN (` +
    `SELECT id FROM "BankAccount" WHERE name LIKE 'E2E Bank%'); ` +
    `DELETE FROM "BankAccount" WHERE name LIKE 'E2E Bank%';`;
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

test('accountant creates a bank account, maps a CSV, imports it, filters activity, and re-imports duplicates', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Banking', exact: true }).click();
  await expect(page).toHaveURL(/\/banking$/);
  await expect(page.getByRole('heading', { name: 'Banking', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New bank account' }).click();
  const accountForm = page.locator('#bank-account-form');
  await accountForm.getByLabel('Account name').fill('E2E Bank Checking');
  await accountForm.getByLabel('Type').selectOption({ label: 'Checking' });
  await accountForm.getByLabel('Ledger account').selectOption({ label: '1000 · Cash' });
  await accountForm.getByRole('button', { name: 'Add bank account' }).click();
  await expect(accountForm).toBeHidden();
  await expect(page.getByRole('cell', { name: 'E2E Bank Checking' })).toBeVisible();

  const importForm = page.locator('#bank-import-form');
  const fixture = join(process.cwd(), 'tests/e2e/fixtures/bank-activity.csv');

  await page.getByRole('button', { name: 'Import transactions' }).click();
  await importForm.getByLabel('Bank file').setInputFiles(fixture);
  await importForm.getByRole('button', { name: 'Preview import' }).click();
  await expect(importForm.getByText('Choose the date column.')).toBeVisible();
  await importForm.getByLabel('Date column', { exact: true }).selectOption({ label: 'When' });
  await importForm
    .getByLabel('Description column', { exact: true })
    .selectOption({ label: 'What' });
  await importForm.getByRole('button', { name: 'Refresh preview' }).click();

  const preview = importForm.locator('.bank-import-preview');
  await expect(preview).toContainText('3 new');
  await expect(preview).toContainText('INVOICE PAYMENT NORTHWIND');
  await expect(preview).toContainText('OFFICE SUPPLIES, DEPOT');
  await preview.getByRole('button', { name: 'Import transactions' }).click();
  await expect(page.getByText('Imported 3 transactions.')).toBeVisible();

  const table = page.locator('.bank-transaction-table');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table).toContainText('INVOICE PAYMENT NORTHWIND');
  await expect(table).toContainText('$1,200.00');
  await expect(table).toContainText('-$84.25');
  await expect(table).toContainText('bank-activity.csv');
  await expect(table).toContainText('Unmatched');

  await page.getByLabel('Filter transactions by match state').selectOption({ label: 'Matched' });
  await expect(table.locator('tbody')).toContainText('No bank activity in this view.');
  await page
    .getByLabel('Filter transactions by match state')
    .selectOption({ label: 'Unmatched' });
  await expect(table.locator('tbody tr')).toHaveCount(3);

  await page.getByLabel('Search bank transactions').fill('NORTHWIND');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('INVOICE PAYMENT NORTHWIND');
  await page.getByLabel('Search bank transactions').fill('');

  await page.getByLabel('Transactions from date').fill('2026-10-01');
  await page.getByLabel('Transactions to date').fill('2026-10-03');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page.getByLabel('Transactions from date').fill('');
  await page.getByLabel('Transactions to date').fill('');
  await expect(table.locator('tbody tr')).toHaveCount(3);

  await page.getByRole('button', { name: 'Import transactions' }).click();
  await importForm.getByLabel('Bank file').setInputFiles(fixture);
  await importForm.getByRole('button', { name: 'Preview import' }).click();
  await importForm.getByLabel('Date column', { exact: true }).selectOption({ label: 'When' });
  await importForm
    .getByLabel('Description column', { exact: true })
    .selectOption({ label: 'What' });
  await importForm.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(importForm.locator('.bank-import-preview')).toContainText('3 duplicates');
  await importForm
    .locator('.bank-import-preview')
    .getByRole('button', { name: 'Import transactions' })
    .click();
  await expect(
    page.getByText('Imported 0 transactions; 3 duplicates skipped.'),
  ).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(3);
});
