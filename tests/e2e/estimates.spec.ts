import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IN ` +
    `(SELECT "convertedInvoiceId" FROM "Estimate" WHERE notes LIKE 'E2E estimate%'); ` +
    `UPDATE "Estimate" SET "convertedInvoiceId" = NULL WHERE notes LIKE 'E2E estimate%'; ` +
    `DELETE FROM "Invoice" WHERE notes LIKE 'E2E estimate%'; ` +
    `DELETE FROM "Estimate" WHERE notes LIKE 'E2E estimate%'; ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IS NOT NULL ` +
    `AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "JournalEntry"."sourceId");`;
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

test('staff creates an estimate and converts it into a draft invoice', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Estimates' }).click();
  await expect(page).toHaveURL(/\/estimates$/);
  await expect(page.getByRole('heading', { name: 'Estimates' })).toBeVisible();
  await expect(page.locator('.estimate-table tbody tr', { hasText: 'EST-1001' })).toBeVisible();

  await page.getByRole('button', { name: 'New estimate' }).click();
  const form = page.locator('#estimate-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Customer', { exact: true }).selectOption({ label: 'Northwind Studio' });
  await form.getByLabel('Issue date').fill('2026-11-12');
  await form.getByLabel('Expires').fill('2026-12-12');
  await form.getByLabel('Tax rate (%)').fill('8.25');
  await form.getByLabel('Line 1 item').selectOption({ label: 'Design package' });
  await form.getByLabel('Line 1 quantity').fill('1');
  await form.getByLabel('Line 1 rate').fill('900');
  await form.getByLabel('Notes').fill('E2E estimate quote');

  const totals = form.locator('.invoice-form__totals');
  await expect(totals.getByText('$900.00')).toBeVisible();
  await expect(totals.getByText('$74.25')).toBeVisible();
  await expect(totals.getByText('$974.25')).toBeVisible();

  await form.getByRole('button', { name: 'Create estimate' }).click();
  await expect(form).toBeHidden();

  const detail = page.locator('#estimate-detail');
  await expect(detail).toBeVisible();
  const estimateNumber = (await detail.locator('#estimate-detail-number').innerText())
    .replace('Estimate ', '')
    .trim();
  expect(estimateNumber).toMatch(/^EST-\d{4}$/);
  await expect(detail.locator('.status')).toHaveText('Draft');
  await expect(detail.getByText('$974.25')).toBeVisible();

  await detail.getByRole('button', { name: 'Edit estimate' }).click();
  await expect(form).toBeVisible();
  await form.getByLabel('Line 1 quantity').fill('2');
  await expect(form.locator('.invoice-form__totals').getByText('$1,948.50')).toBeVisible();
  await form.getByRole('button', { name: 'Save estimate' }).click();
  await expect(form).toBeHidden();
  await expect(detail.getByText('$1,948.50')).toBeVisible();

  await detail.getByRole('button', { name: 'Accept quote' }).click();
  await expect(detail.locator('.status')).toHaveText('Accepted');
  await detail.getByRole('button', { name: 'Convert to invoice' }).click();

  await expect(detail.getByText(/Converted to INV-\d{4}\./)).toBeVisible();
  const invoiceNumber = (await detail.getByText(/Converted to INV-\d{4}\./).innerText())
    .match(/INV-\d{4}/)![0];
  await expect(detail.getByRole('button', { name: 'Convert to invoice' })).toHaveCount(0);
  await expect(
    detail.getByText('This estimate is locked to that invoice.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Invoices', exact: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.getByLabel('Search invoices').fill(invoiceNumber);
  const invoiceRow = page.locator('.invoice-table tbody tr', { hasText: invoiceNumber });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText('Draft', { exact: true })).toBeVisible();
  await expect(invoiceRow.getByText('$1,948.50').first()).toBeVisible();

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(
    page.locator('.journal-table tbody tr', {
      hasText: `Invoice ${invoiceNumber} — Northwind Studio`,
    }),
  ).toHaveCount(0);

  await page.getByRole('link', { name: 'Estimates' }).click();
  await expect(page).toHaveURL(/\/estimates$/);
  await page.getByLabel('Search estimates').fill(estimateNumber);
  const estimateRow = page.locator('.estimate-table tbody tr', { hasText: estimateNumber });
  await expect(estimateRow).toBeVisible();
  await expect(estimateRow.getByText('Accepted', { exact: true })).toBeVisible();
  await expect(estimateRow.getByText(invoiceNumber)).toBeVisible();
});
