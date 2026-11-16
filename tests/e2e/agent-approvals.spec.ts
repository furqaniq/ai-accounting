import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const PROMPT =
  'PW approval invoice: create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.';

const CLEANUP_SQL = `
DELETE FROM "AuditLogEntry"
WHERE ("entityType" = 'AgentProposal' AND "entityId" IN (
  SELECT id FROM "AgentProposal" WHERE "jobId" IN (
    SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%'
  )
))
OR ("entityType" = 'Invoice' AND "action" = 'invoice.create' AND "entityId" IN (
  SELECT result->>'id' FROM "AgentProposal"
  WHERE "toolName" = 'invoice.create' AND result->>'id' IS NOT NULL
    AND "jobId" IN (SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%')
));
DELETE FROM "InvoiceLine" WHERE "invoiceId" IN (
  SELECT result->>'id' FROM "AgentProposal"
  WHERE "toolName" = 'invoice.create' AND result->>'id' IS NOT NULL
    AND "jobId" IN (SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%')
);
DELETE FROM "Invoice" WHERE id IN (
  SELECT result->>'id' FROM "AgentProposal"
  WHERE "toolName" = 'invoice.create' AND result->>'id' IS NOT NULL
    AND "jobId" IN (SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%')
);
DELETE FROM "AgentActionLog" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%'
) OR "proposalId" IN (
  SELECT id FROM "AgentProposal" WHERE "jobId" IN (
    SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%'
  )
);
DELETE FROM "AgentProposal" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%'
);
DELETE FROM "AgentJob" WHERE prompt LIKE 'PW approval invoice%';
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

async function propose(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Ask the clerk to do something').fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const transcript = page.getByRole('log', { name: 'Conversation with the clerk' });
  await expect(transcript).toContainText(PROMPT);
  await expect(transcript).toContainText('is waiting for Owner or Admin approval', {
    timeout: 20_000,
  });
}

test.beforeAll(() => {
  cleanup();
});

test.afterAll(() => {
  cleanup();
});

test('owner proposes a draft invoice, approves it, and opens the created invoice', async ({
  page,
}) => {
  await signIn(page);
  await propose(page);

  await page.getByRole('tab', { name: /Approvals/ }).click();
  const panel = page.locator('#agent-panel-approvals');
  await expect(panel.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  const card = panel.locator('.approval').first();
  await expect(card).toContainText('Create draft invoice');
  await expect(card).toContainText('invoice.create');
  await expect(card).toContainText('Northwind Studio');
  await expect(card).toContainText('Pending');

  await panel.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(panel.getByText('Latest decision')).toBeVisible();
  const approved = panel.locator('.approval__result--approved').first();
  await expect(approved).toContainText('executed');

  const link = panel.getByRole('link', { name: /Open INV-/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/invoices\?invoice=/);
  await expect(page.locator('#detail-number')).toContainText(/Invoice INV-\d+/);
  await expect(page.locator('#invoice-detail')).toContainText('Northwind Studio');
});

test('owner rejects a proposal and sees that no books changed', async ({ page }) => {
  await signIn(page);
  await propose(page);

  await page.getByRole('tab', { name: /Approvals/ }).click();
  const panel = page.locator('#agent-panel-approvals');
  const card = panel.locator('.approval').first();
  await expect(card).toContainText('Create draft invoice');
  await expect(card).toContainText('Pending');

  await panel.getByRole('button', { name: 'Reject', exact: true }).first().click();
  await expect(panel.getByText('Rejected. No books were changed.')).toBeVisible();
  const decided = panel.locator('.approval__result--rejected').first();
  await expect(decided).toContainText('No books were changed');
  await expect(panel.getByRole('link', { name: /Open INV-/ })).toHaveCount(0);
});
