import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const PROMPT =
  'PW policy invoice: create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.';

const CLEANUP_SQL = `
DELETE FROM "AuditLogEntry"
WHERE ("entityType" = 'Invoice' AND "entityId" IN (
  SELECT l.output->>'id' FROM "AgentActionLog" l
  JOIN "AgentJob" j ON j.id = l."jobId"
  WHERE j.prompt LIKE 'PW policy invoice%' AND l.output ? 'id'
))
OR ("entityType" = 'AgentToolPolicy' AND "organizationId" = (
  SELECT id FROM "Organization" WHERE name = 'Acme Services Co.'
));
DELETE FROM "InvoiceLine" WHERE "invoiceId" IN (
  SELECT l.output->>'id' FROM "AgentActionLog" l
  JOIN "AgentJob" j ON j.id = l."jobId"
  WHERE j.prompt LIKE 'PW policy invoice%' AND l.output ? 'id'
);
DELETE FROM "Invoice" WHERE id IN (
  SELECT l.output->>'id' FROM "AgentActionLog" l
  JOIN "AgentJob" j ON j.id = l."jobId"
  WHERE j.prompt LIKE 'PW policy invoice%' AND l.output ? 'id'
);
DELETE FROM "AgentActionLog" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW policy invoice%'
);
DELETE FROM "AgentProposal" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW policy invoice%'
);
DELETE FROM "AgentJob" WHERE prompt LIKE 'PW policy invoice%';
DELETE FROM "AgentToolPolicy" WHERE "toolName" = 'invoice.create' AND "organizationId" = (
  SELECT id FROM "Organization" WHERE name = 'Acme Services Co.'
);
`;

function cleanup(): void {
  try {
    execFileSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'daybook',
        '-d',
        'daybook',
        '-c',
        CLEANUP_SQL,
      ],
      { cwd: process.cwd(), stdio: 'ignore' },
    );
  } catch {
    // Best-effort cleanup; the agent log is append-only in the app itself.
  }
}

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Clerk' }).click();
  await expect(page).toHaveURL(/\/agent$/);
}

test.beforeAll(() => {
  cleanup();
});

test.afterAll(() => {
  cleanup();
});

test('owner changes invoice.create to auto-execute and Clerk creates a draft without approval', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('tab', { name: 'Policies' }).click();
  const panel = page.locator('#agent-panel-policies');
  await expect(panel.getByRole('heading', { name: 'Policies' })).toBeVisible();
  await expect(panel.getByRole('note')).toContainText(
    'Auto-execute creates records without review',
  );

  const row = panel.locator('tbody tr', { hasText: 'invoice.create' });
  await expect(row).toContainText('Sensitive write');
  await expect(row).toContainText('Requires approval');
  const select = row.getByLabel('Policy for Create draft invoice');
  await expect(select).toHaveValue('approve');

  await select.selectOption('auto');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(
    'will execute automatically on the next run',
  );
  await expect(select).toHaveValue('auto');

  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Ask the clerk to do something').fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const transcript = page.getByRole('log', { name: 'Conversation with the clerk' });
  await expect(transcript).toContainText(PROMPT);
  await expect(transcript).toContainText(
    'Executed automatically under this organization’s policy.',
    { timeout: 20_000 },
  );
  await expect(transcript).not.toContainText('is waiting for Owner or Admin approval');
  await expect(transcript).toContainText(/Created INV-\d+ automatically/);
  const transcriptText = (await transcript.textContent()) ?? '';
  const invoiceNumber = transcriptText.match(/INV-\d+/)?.[0];
  expect(invoiceNumber).toBeTruthy();

  await page.getByRole('tab', { name: 'Activity' }).click();
  const activity = page.locator('#agent-panel-activity');
  const activityRow = activity
    .locator('tbody tr', { hasText: 'invoice.create' })
    .first();
  await expect(activityRow).toContainText('Completed');

  await page.goto('/invoices');
  await page.getByLabel('Search invoices').fill(invoiceNumber!);
  const invoiceRow = page.locator('.invoice-table tbody tr', { hasText: invoiceNumber! }).first();
  await expect(invoiceRow).toContainText('Northwind Studio');
  await expect(invoiceRow).toContainText('Draft');

  await page.getByRole('link', { name: 'Clerk' }).click();
  await page.getByRole('tab', { name: 'Policies' }).click();
  const resetRow = page
    .locator('#agent-panel-policies tbody tr', { hasText: 'invoice.create' });
  await resetRow.getByLabel('Policy for Create draft invoice').selectOption('approve');
  await resetRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(resetRow.getByLabel('Policy for Create draft invoice')).toHaveValue(
    'approve',
  );
});
