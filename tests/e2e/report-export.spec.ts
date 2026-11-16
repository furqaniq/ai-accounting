import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('accountant downloads CSV and PDF exports of the selected report', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole('tab', { name: 'Sales by customer' }).click();
  await page.getByLabel('From date').fill('2026-01-01');
  await page.getByLabel('To date').fill('2026-12-31');
  await expect(page.locator('.statement-sheet tbody')).toContainText('Northwind Studio');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV', exact: true }).click(),
  ]);
  expect(csvDownload.suggestedFilename()).toBe(
    'sales-by-customer-2026-01-01_2026-12-31.csv',
  );
  const csvPath = await csvDownload.path();
  expect(csvPath).not.toBeNull();
  const csv = readFileSync(csvPath!, 'utf8');
  expect(csv).toContain('Acme Services Co.');
  expect(csv).toContain('Sales by customer');
  expect(csv).toContain('2026-01-01 to 2026-12-31');
  expect(csv).toContain('Total sales');
  expect(csv).toContain('1200.00');
  expect(csv).toContain('1274.25');
  expect(csv).not.toContain('Could not export');

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PDF', exact: true }).click(),
  ]);
  expect(pdfDownload.suggestedFilename()).toBe(
    'sales-by-customer-2026-01-01_2026-12-31.pdf',
  );
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  expect(readFileSync(pdfPath!).subarray(0, 5).toString()).toBe('%PDF-');
});
