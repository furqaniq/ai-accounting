import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';

function runSql(sql: string): void {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'daybook', '-d', 'daybook', '-c', sql],
    { stdio: 'ignore' },
  );
}

function cleanTestRows(): void {
  const accountIds =
    `SELECT id FROM "BankAccount" WHERE name LIKE 'E2E Reconcile Bank%'`;
  const ledgerIds =
    `SELECT id FROM "Account" WHERE name LIKE 'E2E Reconcile Ledger%'`;
  const transactionIds =
    `SELECT id FROM "BankTransaction" WHERE "bankAccountId" IN (${accountIds})`;
  const journalIds =
    `SELECT id FROM "JournalEntry" WHERE memo LIKE 'E2E reconcile%'`;
  const sql =
    `DELETE FROM "JournalLine" WHERE "entryId" IN (${journalIds}); ` +
    `DELETE FROM "JournalEntry" WHERE id IN (${journalIds}); ` +
    `DELETE FROM "BankTransaction" WHERE id IN (${transactionIds}); ` +
    `DELETE FROM "BankImportBatch" WHERE "bankAccountId" IN (${accountIds}); ` +
    `DELETE FROM "ReconciliationSession" WHERE "bankAccountId" IN (${accountIds}); ` +
    `DELETE FROM "BankAccount" WHERE id IN (${accountIds}); ` +
    `DELETE FROM "Account" WHERE id IN (${ledgerIds});`;
  runSql(sql);
}

interface Session {
  token: string;
  orgId: string;
  headers: Record<string, string>;
}

async function apiSession(request: APIRequestContext): Promise<Session> {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'accountant@acme.test', password: 'Passw0rd!2026' },
  });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  const meRes = await request.get(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${body.accessToken}` },
  });
  const me = await meRes.json();
  const orgId = me.memberships.find(
    (membership: { organizationName: string }) =>
      membership.organizationName === 'Acme Services Co.',
  ).organizationId;
  return {
    token: body.accessToken,
    orgId,
    headers: {
      Authorization: `Bearer ${body.accessToken}`,
      'X-Organization-Id': orgId,
      'Content-Type': 'application/json',
    },
  };
}

test.beforeAll(() => {
  cleanTestRows();
});

test.afterAll(() => {
  cleanTestRows();
});

test('accountant starts a reconciliation, marks items cleared, and resumes the session', async ({
  page,
  request,
}) => {
  const session = await apiSession(request);
  const accounts = await (
    await request.get(`${API}/accounts`, { headers: session.headers })
  ).json();
  const cashId = accounts.accounts.find(
    (account: { code: string }) => account.code === '1000',
  ).id;

  const ledgerRes = await request.post(`${API}/accounts`, {
    headers: session.headers,
    data: {
      code: '1911',
      name: 'E2E Reconcile Ledger',
      type: 'ASSET',
    },
  });
  expect(ledgerRes.status()).toBe(201);
  const ledger = await ledgerRes.json();

  const bankRes = await request.post(`${API}/bank-accounts`, {
    headers: session.headers,
    data: {
      name: 'E2E Reconcile Bank Checking',
      type: 'CHECKING',
      ledgerAccountId: ledger.id,
    },
  });
  expect(bankRes.status()).toBe(201);
  const bank = await bankRes.json();

  async function postJournal(
    date: string,
    debit: number,
    memo: string,
  ): Promise<void> {
    const res = await request.post(`${API}/journal-entries`, {
      headers: session.headers,
      data: {
        date,
        memo: `E2E reconcile ${memo}`,
        lines: [
          { accountId: ledger.id, debit },
          { accountId: cashId, credit: debit },
        ],
      },
    });
    expect(res.status()).toBe(201);
  }

  await postJournal('2026-09-30', 1000, 'opening balance');
  await postJournal('2026-10-10', 150, 'mid-period entry');

  const csv =
    'Date,Description,Amount,Reference\n' +
    '2026-10-05,E2E RECON DEPOSIT,500.00,E2E-RECON-1\n' +
    '2026-10-06,E2E RECON WITHDRAWAL,-200.00,E2E-RECON-2\n';
  const importRes = await request.post(`${API}/bank-imports`, {
    headers: { Authorization: session.headers.Authorization, 'X-Organization-Id': session.orgId },
    multipart: {
      bankAccountId: bank.id,
      file: {
        name: 'e2e-reconciliation.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      },
    },
  });
  expect(importRes.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Email').fill('accountant@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Reconcile', exact: true }).click();
  await expect(page).toHaveURL(/\/reconcile$/);

  const form = page.locator('#reconcile-form');
  await page.getByRole('button', { name: 'New session' }).click();
  await form
    .getByLabel('Bank account')
    .selectOption({ label: 'E2E Reconcile Bank Checking · 1911 E2E Reconcile Ledger' });
  await form.getByLabel('Period start').fill('2026-10-01');
  await form.getByLabel('Period end').fill('2026-10-31');
  await form.getByLabel('Statement ending balance').fill('1300');
  await form.getByRole('button', { name: 'Start reconciliation' }).click();
  await expect(form).toBeHidden();

  const summary = page.locator('.reconcile-summary');
  const value = (label: string) =>
    summary
      .locator('.reconcile-summary__item')
      .filter({ hasText: label })
      .locator('.reconcile-summary__value');
  await expect(value('Statement balance')).toHaveText('$1,300.00');
  await expect(value('Cleared total')).toHaveText('$0.00');
  await expect(value('Book balance')).toHaveText('$1,150.00');
  await expect(value('Difference')).toHaveText('$300.00');

  const table = page.locator('.reconcile-transaction-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  const depositRow = table.locator('tbody tr').filter({ hasText: 'E2E RECON DEPOSIT' });
  const withdrawalRow = table
    .locator('tbody tr')
    .filter({ hasText: 'E2E RECON WITHDRAWAL' });

  await depositRow.getByRole('checkbox').click();
  await expect(depositRow.getByRole('checkbox')).toBeChecked();
  await expect(depositRow).toContainText('Cleared');
  await expect(value('Cleared total')).toHaveText('$500.00');
  await expect(value('Difference')).toHaveText('-$200.00');

  await withdrawalRow.getByRole('checkbox').click();
  await expect(withdrawalRow.getByRole('checkbox')).toBeChecked();
  await expect(value('Cleared total')).toHaveText('$300.00');
  await expect(value('Difference')).toHaveText('$0.00');
  await expect(value('Difference')).toHaveClass(/is-balanced/);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reconciliation', level: 1 })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(depositRow.getByRole('checkbox')).toBeChecked();
  await expect(withdrawalRow.getByRole('checkbox')).toBeChecked();
  await expect(value('Difference')).toHaveText('$0.00');

  await withdrawalRow.getByRole('checkbox').click();
  await expect(withdrawalRow.getByRole('checkbox')).not.toBeChecked();
  await expect(value('Cleared total')).toHaveText('$500.00');
  await expect(value('Difference')).toHaveText('-$200.00');
  await expect(withdrawalRow.getByRole('checkbox')).not.toBeChecked();
});
