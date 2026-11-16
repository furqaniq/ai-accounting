import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const NAME = `PW auto ${Date.now()}`;
const PROMPT = `PW auto prompt: what is my cash position?`;

const CLEANUP_SQL = `
DELETE FROM "AgentActionLog" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW auto prompt%'
);
DELETE FROM "AgentProposal" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW auto prompt%'
);
DELETE FROM "AgentJob" WHERE prompt LIKE 'PW auto prompt%';
DELETE FROM "AuditLogEntry" WHERE "entityType" = 'AgentAutomation' AND (
  "metadata"->>'name' LIKE 'PW auto %'
  OR "entityId" IN (SELECT id FROM "AgentAutomation" WHERE name LIKE 'PW auto %')
);
DELETE FROM "AgentAutomation" WHERE name LIKE 'PW auto %';
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

test('creates, edits, pauses, runs, and deletes a scheduled automation', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('tab', { name: 'Automations' }).click();
  const panel = page.locator('#agent-panel-automations');
  await expect(panel.getByRole('heading', { name: 'Automations' })).toBeVisible();
  await expect(panel).toContainText('No automations yet');

  await panel.getByRole('button', { name: 'New automation' }).click();
  await panel.getByLabel('Name').fill(NAME);
  await panel.getByLabel('Schedule preset').selectOption('monday-9');
  await panel.getByLabel('Prompt').fill(PROMPT);
  await expect(panel).toContainText('Runs Every Monday at 9:00 AM');
  await panel.getByRole('button', { name: 'Create automation' }).click();

  await expect(panel.getByRole('status')).toContainText(`Created “${NAME}”`);
  const row = panel.locator('.automation-table tbody tr', { hasText: NAME });
  await expect(row).toContainText('Every Monday at 9:00 AM');
  await expect(row).toContainText('Enabled');
  await expect(row).toContainText('Not yet run');
  await expect(panel).not.toContainText('No automations yet');

  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.getByLabel('Schedule preset').selectOption('weekdays-9');
  await expect(panel.getByLabel('Cron (five fields)')).toHaveValue('0 9 * * 1-5');
  await panel.getByRole('button', { name: 'Save automation' }).click();
  await expect(panel.getByRole('status')).toContainText('Every weekday at 9:00 AM');
  const editedRow = panel.locator('.automation-table tbody tr', { hasText: NAME });
  await expect(editedRow).toContainText('Every weekday at 9:00 AM');

  const toggle = editedRow.getByRole('switch', { name: `Enable ${NAME}` });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(panel.getByRole('status')).toContainText(`Paused “${NAME}”`);
  await expect(editedRow).toContainText('Paused');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(panel.getByRole('status')).toContainText(`Resumed “${NAME}”`);
  await expect(toggle).toBeChecked();

  const headers = await auth(page);
  const list = await page.request.get(`${API}/agent/automations`, { headers });
  expect(list.ok()).toBeTruthy();
  const automations = (await list.json()) as {
    automations: Array<{ id: string; name: string }>;
  };
  const automation = automations.automations.find((entry) => entry.name === NAME);
  expect(automation).toBeTruthy();

  const run = await page.request.post(
    `${API}/agent/test/automations/${automation!.id}/run`,
    { headers },
  );
  expect(run.ok()).toBeTruthy();
  const { jobId } = (await run.json()) as { jobId: string };
  expect(jobId).toBeTruthy();

  let status = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await page.request.get(`${API}/agent/jobs/${jobId}`, { headers });
    expect(job.ok()).toBeTruthy();
    status = ((await job.json()) as { status: string }).status;
    if (status === 'COMPLETED' || status === 'FAILED') break;
    await sleep(500);
  }
  expect(status).toBe('COMPLETED');

  await page.reload();
  await page.getByRole('tab', { name: 'Automations' }).click();
  const ranRow = page.locator('.automation-table tbody tr', { hasText: NAME });
  await expect(ranRow).toContainText('Completed');
  await expect(ranRow).toContainText(/AGT-\d+/);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const activity = page.locator('#agent-panel-activity');
  await activity.getByLabel('Trigger').selectOption('CRON');
  const activityRow = activity.locator('tbody tr', { hasText: 'insight.query' }).first();
  await expect(activityRow).toContainText('Schedule');
  await expect(activityRow).toContainText('Completed');

  await page.getByRole('tab', { name: 'Automations' }).click();
  const deleteRow = page.locator('.automation-table tbody tr', { hasText: NAME });
  await deleteRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await deleteRow.getByRole('button', { name: 'Delete schedule' }).click();
  await expect(page.locator('#agent-panel-automations').getByRole('status')).toContainText(
    `Deleted “${NAME}”`,
  );
  await expect(
    page.locator('.automation-table tbody tr', { hasText: NAME }),
  ).toHaveCount(0);
});
