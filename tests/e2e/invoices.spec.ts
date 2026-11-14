import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IN ` +
    `(SELECT id FROM "Invoice" WHERE notes LIKE 'E2E %'); ` +
    `DELETE FROM "Invoice" WHERE notes LIKE 'E2E %';`;
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

test('staff creates, edits, and sends an invoice into the ledger', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Invoices' }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.locator('.invoice-table tbody tr', { hasText: 'INV-1001' })).toBeVisible();

  await page.getByRole('button', { name: 'Overdue', exact: true }).click();
  await expect(
    page.locator('.invoice-table tbody tr', { hasText: 'Harbor & Pine' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();

  await page.getByRole('button', { name: 'New invoice' }).click();
  const form = page.locator('#invoice-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Customer', { exact: true }).selectOption({ label: 'Northwind Studio' });
  await form.getByLabel('Issue date').fill('2026-11-01');
  await form.getByLabel('Due date').fill('2026-12-01');
  await form.getByLabel('Tax rate (%)').fill('8.25');
  await form.getByLabel('Line 1 item').selectOption({ label: 'Design package' });
  await form.getByLabel('Line 1 quantity').fill('1');
  await form.getByLabel('Line 1 rate').fill('900');
  await form.getByLabel('Notes').fill('E2E invoice');

  const totals = form.locator('.invoice-form__totals');
  await expect(totals.getByText('$900.00')).toBeVisible();
  await expect(totals.getByText('$74.25')).toBeVisible();
  await expect(totals.getByText('$974.25')).toBeVisible();

  await form.getByRole('button', { name: 'Create draft' }).click();
  await expect(form).toBeHidden();

  const detail = page.locator('#invoice-detail');
  await expect(detail).toBeVisible();
  const number = (await detail.locator('#detail-number').innerText())
    .replace('Invoice ', '')
    .trim();
  expect(number).toMatch(/^INV-\d{4}$/);
  await expect(detail.locator('.status')).toHaveText('Draft');
  await expect(detail.getByText('$974.25')).toBeVisible();

  await detail.getByRole('button', { name: 'Edit invoice' }).click();
  await expect(form).toBeVisible();
  await form.getByLabel('Line 1 quantity').fill('2');
  await expect(form.locator('.invoice-form__totals').getByText('$1,948.50')).toBeVisible();
  await form.getByRole('button', { name: 'Save invoice' }).click();
  await expect(form).toBeHidden();
  await expect(detail.getByText('$1,948.50')).toBeVisible();

  await detail.getByRole('button', { name: 'Mark as sent' }).click();
  await expect(detail.locator('.status')).toHaveText('Sent');
  await expect(detail.getByText('Balance due $1,948.50.')).toBeVisible();

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  const postedRow = page.locator('.journal-table tbody tr', {
    hasText: `Invoice ${number} — Northwind Studio`,
  });
  await expect(postedRow).toBeVisible();
  await expect(postedRow.getByText('Invoice', { exact: true })).toBeVisible();
  await expect(postedRow.locator('.journal-ref')).toHaveText(/^JE-\d{4}$/);

  await page.getByRole('link', { name: 'Invoices' }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.getByLabel('Search invoices').fill(number);
  const row = page.locator('.invoice-table tbody tr', { hasText: number });
  await expect(row).toBeVisible();
  await expect(row.getByText('Sent', { exact: true })).toBeVisible();
  await expect(row.getByText('$1,948.50').first()).toBeVisible();
});
