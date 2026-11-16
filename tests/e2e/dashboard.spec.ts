import { expect, test } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

async function setPeriod(page: import('@playwright/test').Page, from: string, to: string) {
  await page.getByLabel('From date').fill(from);
  await page.getByLabel('To date').fill(to);
  await expect(page.locator('.section__meta').first()).toContainText('2026');
}

test('owner reads the seeded dashboard, changes the period, and opens a recent document', async ({
  page,
}) => {
  await signIn(page);

  const cashFigure = page.locator('.cash__figure');
  await expect(cashFigure).toHaveText('$5,000.00');

  const receivables = page.locator('.stat', { hasText: 'Receivables' });
  const payables = page.locator('.stat', { hasText: 'Payables' });
  await expect(receivables).toContainText('$1,274.25');
  await expect(receivables).toContainText('$974.25 overdue');
  await expect(payables).toContainText('$1,124.50');
  await expect(payables).toContainText('$475.00 overdue');

  await setPeriod(page, '2026-01-01', '2026-11-14');
  const netIncome = page.locator('.stat', { hasText: 'Net income' });
  await expect(netIncome).toContainText('$125.00');
  await expect(netIncome).toContainText('$1,200.00 income');
  await expect(netIncome).toContainText('$1,075.00 expenses');
  await expect(page.locator('.trend-chart')).toBeVisible();
  await expect(page.locator('.trend-legend')).toContainText('Income');
  await expect(page.locator('.trend-legend')).toContainText('Expenses');

  const activity = page.locator('.section', { hasText: 'Recent activity' });
  await expect(activity).toContainText('INV-1002');
  await expect(activity).toContainText('BILL-1001');
  await expect(activity).toContainText('Harbor & Pine');

  await setPeriod(page, '2026-10-16', '2026-11-14');
  await expect(netIncome).toContainText('$300.00 income');
  await expect(netIncome).toContainText('$600.00 expenses');
  await expect(netIncome).toContainText('-$300.00');

  await page.locator('main').getByRole('link', { name: 'INV-1001' }).first().click();
  await expect(page).toHaveURL(/\/invoices\?invoice=/);
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await expect(page.getByText('INV-1001').first()).toBeVisible();
});

test('owner drills into AR aging and the dashboard stays usable on tablet', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page);
  await setPeriod(page, '2026-01-01', '2026-11-14');

  await expect(page.locator('.cash__figure')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'Receivables' })).toContainText('$1,274.25');
  await expect(page.locator('.cash__figure')).toBeInViewport();

  await expect(page.locator('#period-toggle')).toBeVisible();
  await page.locator('#period-toggle').click();
  const margin = page.locator('#margin');
  await expect(margin).toContainText('Needs attention');
  await expect(margin).toContainText('Overdue invoices');
  await page.getByLabel('Close period summary').click();

  await page.getByRole('link', { name: 'Receivables', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/ar-aging$/);
  await expect(page.getByRole('heading', { name: 'AR aging', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Receivables aging' })).toBeVisible();
  await expect(page.locator('body')).toContainText('$1,274.25');
});
