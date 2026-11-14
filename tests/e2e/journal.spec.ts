import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

function cleanTestEntries(): void {
  const sql =
    'DELETE FROM "JournalEntry" WHERE "reversalOfId" IN ' +
    `(SELECT id FROM "JournalEntry" WHERE memo LIKE 'E2E %'); ` +
    `DELETE FROM "JournalEntry" WHERE memo LIKE 'E2E %';`;
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

function parseMoney(value: string): number {
  return Number(value.replace(/[^0-9.-]/g, ''));
}

async function closingBalance(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.locator('.register-balance > span').nth(1).locator('strong').innerText();
  return parseMoney(text);
}

test.beforeAll(() => {
  cleanTestEntries();
});

test('accountant posts a balanced entry, inspects the register, and reverses it', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(page.getByRole('heading', { name: 'General ledger' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account register' })).toBeVisible();
  await expect(
    page.locator('.register-table tbody tr', { hasText: 'Cash brought forward' }),
  ).toBeVisible();

  const before = await closingBalance(page);

  await page.getByRole('button', { name: 'New entry' }).click();
  const form = page.locator('#journal-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Entry date').fill('2026-02-15');
  await form.getByLabel('Memo').fill('E2E journal entry');
  await form.getByLabel('Line 1 account').selectOption({ label: '1000 — Cash' });
  await form.getByLabel('Line 1 debit').fill('250');
  await form.getByLabel('Line 2 account').selectOption({ label: '4000 — Sales income' });
  await form.getByLabel('Line 2 credit').fill('250');
  await expect(form.getByText('Balanced — ready to post.')).toBeVisible();
  await form.getByRole('button', { name: 'Post entry' }).click();
  await expect(form).toBeHidden();

  const entryRow = page.locator('.journal-table tbody tr', { hasText: 'E2E journal entry' });
  await expect(entryRow).toBeVisible();
  const reference = (await entryRow.locator('.journal-ref').innerText()).trim();
  expect(reference).toMatch(/^JE-\d{4}$/);
  await expect(entryRow.getByText('Posted', { exact: true })).toBeVisible();

  await expect.poll(() => closingBalance(page)).toBe(before + 250);
  const registerRow = page.locator('.register-table tbody tr', { hasText: reference });
  await expect(registerRow).toBeVisible();
  await expect(registerRow.getByText('$250.00', { exact: true }).first()).toBeVisible();

  await registerRow.click();
  const detail = page.locator('#entry-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Manual entry', { exact: true })).toBeVisible();
  await expect(detail.getByText('1000 — Cash')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();

  await page.getByRole('button', { name: 'New entry' }).click();
  await expect(form).toBeVisible();
  await form.getByLabel('Line 1 account').selectOption({ label: '1000 — Cash' });
  await form.getByLabel('Line 1 debit').fill('100');
  await form.getByLabel('Line 2 account').selectOption({ label: '4000 — Sales income' });
  await form.getByLabel('Line 2 credit').fill('60');
  await expect(form.getByText('Out of balance by $40.00')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Post entry' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  await entryRow.click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Reverse entry' }).click();
  await detail.getByRole('button', { name: 'Confirm reversal' }).click();
  await expect(detail).toBeHidden();

  await expect(entryRow.getByText('Reversed', { exact: true })).toBeVisible();
  await expect(
    page.locator('.journal-table tbody tr', { hasText: `Reversal of ${reference}` }),
  ).toBeVisible();
  await expect.poll(() => closingBalance(page)).toBe(before);

  await page.getByLabel('Register from').fill('2026-02-15');
  await page.getByLabel('Register to').fill('2026-02-15');
  await expect(
    page.locator('.register-table tbody tr', { hasText: reference }).first(),
  ).toBeVisible();
  await page.getByLabel('Register from').fill('2026-02-16');
  await expect(page.getByText('No posted lines in this period.')).toBeVisible();
});
