import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestRows(): void {
  const sql =
    `DELETE FROM "TimeEntry" WHERE notes LIKE 'E2E TIME%' OR "projectId" IN ` +
    `(SELECT id FROM "Project" WHERE name LIKE 'E2E PROJ%'); ` +
    `DELETE FROM "JournalEntry" WHERE "sourceType" = 'INVOICE' AND "sourceId" IN ` +
    `(SELECT id FROM "Invoice" WHERE notes LIKE 'E2E TIME%'); ` +
    `DELETE FROM "Invoice" WHERE notes LIKE 'E2E TIME%'; ` +
    `DELETE FROM "Project" WHERE name LIKE 'E2E PROJ%';`;
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

test('staff creates a project, logs billable time, and rolls it into a draft invoice', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('staff@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  const projectForm = page.locator('#project-form');
  await expect(projectForm).toBeVisible();
  await projectForm.getByLabel('Name').fill('E2E PROJ Alpha');
  await projectForm.getByLabel('Customer').selectOption({ label: 'Northwind Studio' });
  await projectForm.getByLabel('Billing item').selectOption({ label: 'Design package' });
  await projectForm.getByLabel('Default rate').fill('125');
  await projectForm.getByRole('button', { name: 'Create project' }).click();
  await expect(projectForm).toBeHidden();

  const detail = page.locator('#project-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: /PROJ-\d{4} · E2E PROJ Alpha/ })).toBeVisible();
  await expect(detail).toContainText('Northwind Studio');
  await expect(detail).toContainText('$125.00/hr default');

  await detail.getByRole('button', { name: 'Add time', exact: true }).first().click();
  const timeForm = page.locator('#time-entry-form');
  await expect(timeForm).toBeVisible();
  await timeForm.getByLabel('Date').fill('2026-11-10');
  await timeForm.getByLabel('Hours').fill('2');
  await expect(timeForm.getByLabel('Rate')).toHaveValue('125');
  await timeForm.getByLabel('Notes').fill('E2E TIME design');
  await timeForm.getByRole('button', { name: 'Add time' }).click();
  await expect(timeForm).toBeHidden();

  await detail.getByRole('button', { name: 'Add time', exact: true }).first().click();
  await timeForm.getByLabel('Date').fill('2026-11-11');
  await timeForm.getByLabel('Hours').fill('1.5');
  await timeForm.getByLabel('Rate').fill('100');
  await timeForm.getByLabel('Notes').fill('E2E TIME review');
  await timeForm.getByRole('button', { name: 'Add time' }).click();
  await expect(timeForm).toBeHidden();

  const timeTable = detail.locator('.project-time-table');
  await expect(timeTable).toContainText('Sam Staff');
  await expect(timeTable).toContainText('2');
  await expect(timeTable).toContainText('1.5');
  await expect(detail.getByText('$400.00').first()).toBeVisible();
  await expect(detail).toContainText('3.5 billable hours');

  await detail.getByRole('button', { name: 'Bill time' }).click();
  const rollup = page.locator('#rollup-form');
  await expect(rollup).toBeVisible();
  await expect(rollup.getByLabel('Customer')).toHaveValue(/.+/);
  await expect(rollup.getByLabel('Billing item')).toHaveValue(/.+/);
  await expect(rollup).toContainText('$400.00 selected');
  await rollup.getByLabel('Notes').fill('E2E TIME rollup');
  await rollup.getByRole('button', { name: 'Draft invoice' }).click();
  await expect(rollup).toBeHidden();

  const invoiceLink = detail.locator('.report-note a.invoice-link').first();
  await expect(invoiceLink).toBeVisible();
  const invoiceNumber = (await invoiceLink.innerText()).trim();
  expect(invoiceNumber).toMatch(/^INV-\d{4}$/);
  await expect(detail.locator('.project-time-table')).toContainText(invoiceNumber);
  await expect(detail.locator('.project-time-table').getByText('On invoice')).toHaveCount(2);
  await expect(detail.getByRole('button', { name: 'Bill time' })).toBeDisabled();

  await invoiceLink.click();
  await expect(page).toHaveURL(/\/invoices\?invoice=/);
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  const invoiceDetail = page.locator('#invoice-detail');
  await expect(
    invoiceDetail.getByRole('heading', { name: `Invoice ${invoiceNumber}` }),
  ).toBeVisible();
  await expect(invoiceDetail.locator('.status')).toHaveText('Draft');
  await expect(invoiceDetail.getByText('Time rolled up')).toBeVisible();
  await expect(invoiceDetail).toContainText('Sam Staff');
  await expect(invoiceDetail).toContainText('$400.00');
});
