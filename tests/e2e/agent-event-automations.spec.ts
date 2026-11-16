import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const NAME = `PW event auto ${Date.now()}`;
const PROMPT = `PW event auto prompt: what is my cash position?`;

const CLEANUP_SQL = `
DELETE FROM "AgentActionLog" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW event auto prompt%'
);
DELETE FROM "AgentProposal" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW event auto prompt%'
);
DELETE FROM "AgentJob" WHERE prompt LIKE 'PW event auto prompt%';
DELETE FROM "AuditLogEntry" WHERE "entityType" = 'AgentAutomation' AND (
  "metadata"->>'name' LIKE 'PW event auto %'
  OR "entityId" IN (SELECT id FROM "AgentAutomation" WHERE name LIKE 'PW event auto %')
);
DELETE FROM "AgentAutomation" WHERE name LIKE 'PW event auto %';
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
    // Best-effort cleanup; the spec still asserts through the UI.
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

async function auth(page: import('@playwright/test').Page): Promise<{
  Authorization: string;
  'X-Organization-Id': string;
}> {
  const token = await page.evaluate(() => localStorage.getItem('daybook.accessToken'));
  const organizationId = await page.evaluate(() =>
    localStorage.getItem('daybook.activeOrgId'),
  );
  expect(token).toBeTruthy();
  expect(organizationId).toBeTruthy();
  return {
    Authorization: `Bearer ${token}`,
    'X-Organization-Id': organizationId!,
  };
}

test.beforeAll(() => {
  cleanup();
});

test.afterAll(() => {
  cleanup();
});

test('creates an event automation, fires it through the test hook, and sees the run', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('tab', { name: 'Automations' }).click();
  const panel = page.locator('#agent-panel-automations');
  await expect(panel.getByRole('heading', { name: 'Automations' })).toBeVisible();
  await expect(panel).toContainText('No automations yet');

  await panel.getByRole('button', { name: 'New automation' }).click();
  await panel.getByLabel('Name').fill(NAME);
  await panel.getByLabel('Trigger').selectOption('EVENT');
  await panel.getByLabel('Event').selectOption('BILL_OPENED');
  await panel.getByLabel('Minimum amount').fill('250');
  await panel.getByLabel('Prompt').fill(PROMPT);
  await expect(panel).toContainText('Runs When a bill opens above $250.00');
  await panel.getByRole('button', { name: 'Create automation' }).click();

  await expect(panel.getByRole('status')).toContainText(`Created “${NAME}”`);
  const row = panel.locator('.automation-table tbody tr', { hasText: NAME });
  await expect(row).toContainText('When a bill opens above $250.00');
  await expect(row).toContainText('Event trigger');
  await expect(row).toContainText('Not yet run');
  await expect(panel).not.toContainText('No automations yet');

  const headers = await auth(page);
  const fired = await page.request.post(`${API}/agent/test/events`, {
    headers,
    data: {
      type: 'BILL_OPENED',
      data: {
        number: 'BILL-EVENT-1',
        vendorName: 'Cedar Supply',
        total: 320,
        dueDate: '2026-12-01',
      },
    },
  });
  expect(fired.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const list = await page.request.get(`${API}/agent/automations`, { headers });
        const body = (await list.json()) as {
          automations: Array<{ id: string; name: string; lastStatus: string | null }>;
        };
        return body.automations.find((entry) => entry.name === NAME)?.lastStatus ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe('COMPLETED');

  await page.getByRole('tab', { name: 'Activity' }).click();
  const activity = page.locator('#agent-panel-activity');
  await activity.getByLabel('Trigger').selectOption('EVENT');
  await activity.getByRole('button', { name: 'Refresh' }).click();
  await expect(activity.locator('tbody tr').first()).toContainText('Event');
  await expect(activity.locator('tbody tr').first()).toContainText('Completed');

  await page.getByRole('tab', { name: 'Automations' }).click();
  const ranRow = page.locator('.automation-table tbody tr', { hasText: NAME });
  await expect(ranRow).toContainText('Completed');

  await ranRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await ranRow.getByRole('button', { name: 'Delete schedule' }).click();
  await expect(panel.getByRole('status')).toContainText(`Deleted “${NAME}”`);
  await expect(
    page.locator('.automation-table tbody tr', { hasText: NAME }),
  ).toHaveCount(0);
});
