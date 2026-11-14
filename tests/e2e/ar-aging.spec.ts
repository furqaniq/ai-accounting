import { expect, test } from '@playwright/test';

test('accountant ages receivables, changes the as-of date, and drills into an invoice', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports\/ar-aging$/);
  await expect(page.getByRole('heading', { name: 'AR aging' })).toBeVisible();

  const asOf = page.getByLabel('As of date');
  await asOf.fill('2026-09-30');
  await expect(
    page.getByRole('button', { name: 'View Harbor & Pine Current invoices' }),
  ).toHaveText('$974.25');
  await expect(page.locator('.aging-table tbody')).not.toContainText('Northwind Studio');

  await asOf.fill('2026-11-14');
  await expect(
    page.getByRole('button', { name: 'View Harbor & Pine 1–30 invoices' }),
  ).toHaveText('$974.25');
  await expect(
    page.getByRole('button', { name: 'View Northwind Studio Current invoices' }),
  ).toHaveText('$300.00');
  await expect(page.locator('.aging-table tfoot')).toContainText('$1,274.25');

  const overdue = page
    .locator('.aging-overdue__table tbody tr')
    .filter({ hasText: 'INV-1002' });
  await expect(overdue).toContainText('Harbor & Pine');
  await expect(overdue).toContainText('30');
  await expect(overdue).toContainText('$974.25');

  await page.getByRole('button', { name: 'View Harbor & Pine 1–30 invoices' }).click();
  const drill = page.locator('#aging-drill');
  await expect(drill.getByRole('heading', { name: 'Harbor & Pine · 1–30' })).toBeVisible();
  await expect(drill.getByRole('link', { name: 'INV-1002' })).toBeVisible();

  await drill.getByRole('link', { name: 'INV-1002' }).click();
  await expect(page).toHaveURL(/\/invoices\?invoice=/);
  await expect(page.getByRole('heading', { name: 'Invoice INV-1002' })).toBeVisible();
  await expect(page.locator('#invoice-detail')).toContainText('Harbor & Pine');
});
