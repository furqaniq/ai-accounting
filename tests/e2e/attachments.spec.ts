import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "Attachment" WHERE "entityId" IN (` +
    `SELECT id FROM "Expense" WHERE memo LIKE 'E2E attachment%'); ` +
    `DELETE FROM "JournalEntry" j WHERE j."sourceType" = 'REVERSAL' AND EXISTS (` +
    `SELECT 1 FROM "JournalEntry" orig JOIN "Expense" e ON orig."sourceId" LIKE e.id || '%' ` +
    `WHERE orig.id = j."sourceId" AND e.memo LIKE 'E2E attachment%'); ` +
    `DELETE FROM "JournalEntry" j WHERE j."sourceType" = 'EXPENSE' AND EXISTS (` +
    `SELECT 1 FROM "Expense" e WHERE e.memo LIKE 'E2E attachment%' AND j."sourceId" LIKE e.id || '%'); ` +
    `DELETE FROM "Expense" WHERE memo LIKE 'E2E attachment%';`;
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

test('staff attaches a receipt to an expense, sees it after reload, and removes it', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);

  await page.getByRole('button', { name: 'New expense' }).click();
  const form = page.locator('#expense-form');
  await form.getByLabel('Date').fill('2026-11-13');
  await form.getByLabel('Vendor').selectOption({ label: 'Brightline Utilities' });
  await form.getByLabel('Category').selectOption({ label: '6200 · Supplies expense' });
  await form.getByLabel('Amount').fill('42.5');
  await form.getByLabel('Memo').fill('E2E attachment receipt');
  await form.getByRole('button', { name: 'Record expense' }).click();

  const detail = page.locator('#expense-detail');
  const panel = detail.locator('.attachments');
  await expect(detail.getByRole('heading', { name: /Expense EXP-\d{4}/ })).toBeVisible();
  await expect(panel.getByText('No documents attached yet.')).toBeVisible();

  await panel
    .getByLabel('Attach receipt')
    .setInputFiles(join(process.cwd(), 'tests/e2e/fixtures/receipt.pdf'));
  await expect(panel.locator('.attachment-row__name')).toHaveText('receipt.pdf');
  await expect(panel.getByRole('button', { name: 'View' })).toBeVisible();

  await page.reload();
  await page.getByLabel('Search expenses').fill('E2E attachment receipt');
  await page.locator('.expense-table tbody tr', { hasText: 'E2E attachment receipt' }).click();
  const reloadedPanel = page.locator('#expense-detail .attachments');
  await expect(reloadedPanel.locator('.attachment-row__name')).toHaveText('receipt.pdf');

  await reloadedPanel.getByRole('button', { name: 'Remove receipt.pdf' }).click();
  await expect(reloadedPanel.getByText('No documents attached yet.')).toBeVisible();
});
