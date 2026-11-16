import { execFileSync } from 'node:child_process';
import { expect, Page, test } from '@playwright/test';

const API = 'http://localhost:3001/api/v1';
const PREFIX = `PW slash ${Date.now()}`;
const PROMPT = 'PW slash prompt: what is my cash position?';

const CLEANUP_SQL = `
DELETE FROM "AgentActionLog" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW slash prompt%'
);
DELETE FROM "AgentProposal" WHERE "jobId" IN (
  SELECT id FROM "AgentJob" WHERE prompt LIKE 'PW slash prompt%'
);
DELETE FROM "AgentJob" WHERE prompt LIKE 'PW slash prompt%';
DELETE FROM "AuditLogEntry" WHERE "entityType" = 'AgentAutomation' AND (
  "metadata"->>'name' LIKE 'PW slash %'
  OR "entityId" IN (SELECT id FROM "AgentAutomation" WHERE name LIKE 'PW slash %')
);
DELETE FROM "AgentAutomation" WHERE name LIKE 'PW slash %';
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
    // Best-effort cleanup; assertions still run through the UI.
  }
}

async function signIn(page: Page, email = 'owner@acme.test'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Clerk' }).click();
  await expect(page).toHaveURL(/\/agent$/);
}

async function auth(page: Page): Promise<{
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

test('filters slash commands by prefix and dismisses with Escape', async ({ page }) => {
  await signIn(page);
  const composer = page.getByLabel('Ask the clerk to do something');
  const menu = page.getByRole('listbox', { name: 'Slash commands' });

  await composer.fill('/');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(3);
  await expect(menu).toContainText('/model');
  await expect(menu).toContainText('/cron');
  await expect(menu).toContainText('/event');
  await expect(menu.getByRole('option', { selected: true })).toContainText('/model');

  await composer.fill('/mo');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await expect(menu).toContainText('/model');

  await composer.fill('/cr');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await expect(menu).toContainText('/cron');

  await composer.fill('/zz');
  await expect(menu).toContainText('No commands match');
  await expect(menu.getByRole('option')).toHaveCount(0);

  await composer.fill('/');
  await composer.press('Escape');
  await expect(menu).toBeHidden();
  await expect(composer).toHaveValue('/');
});

test('moves with arrow keys and opens the schedule form with Enter', async ({ page }) => {
  await signIn(page);
  const composer = page.getByLabel('Ask the clerk to do something');
  const menu = page.getByRole('listbox', { name: 'Slash commands' });

  await composer.fill('/');
  await composer.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toContainText('/cron');
  await composer.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toContainText('/event');
  await composer.press('ArrowUp');
  await expect(menu.getByRole('option', { selected: true })).toContainText('/cron');
  await composer.press('Enter');

  await expect(page.getByRole('tab', { name: 'Automations' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const panel = page.locator('#agent-panel-automations');
  await expect(panel.getByLabel('Trigger')).toHaveValue('CRON');
  await expect(panel.getByLabel('Name')).toBeFocused();
  await expect(composer).toHaveValue('');

  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByLabel('Name')).toHaveCount(0);
});

test('selects a command by click and uses the chosen model for prompts only', async ({
  page,
}) => {
  await signIn(page);
  const headers = await auth(page);
  const savedName = `${PREFIX} saved automation`;

  const created = await page.request.post(`${API}/agent/automations`, {
    headers,
    data: {
      name: savedName,
      prompt: 'PW slash saved prompt',
      mode: 'CRON',
      cron: '0 9 * * 1',
      timezone: 'UTC',
      model: 'flash',
    },
  });
  expect(created.ok()).toBeTruthy();
  const savedAutomation = (await created.json()) as { id: string; model: string | null };
  expect(savedAutomation.model).toBe('flash');

  const composer = page.getByLabel('Ask the clerk to do something');
  await composer.fill('/');
  await page
    .getByRole('listbox', { name: 'Slash commands' })
    .getByRole('option')
    .filter({ hasText: '/model' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Choose a model' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await dialog.getByRole('radio', { name: /Flash Lite/ }).click();
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue('');
  await expect(page.locator('.suggestions__meta')).toContainText('Model: Flash Lite');

  await composer.fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const transcript = page.getByRole('log', { name: 'Conversation with the clerk' });
  await expect(transcript).toContainText(PROMPT);
  await expect(transcript).toContainText('Model Flash Lite', { timeout: 20_000 });

  let jobModel: string | null = null;
  await expect
    .poll(
      async () => {
        const logsRes = await page.request.get(`${API}/agent/logs?limit=50`, { headers });
        expect(logsRes.ok()).toBeTruthy();
        const logs = (await logsRes.json()) as {
          logs: Array<{ jobId: string | null; prompt: string | null }>;
        };
        const entry = logs.logs.find((row) => row.prompt === PROMPT && row.jobId);
        if (!entry?.jobId) return 'PENDING';
        const jobRes = await page.request.get(`${API}/agent/jobs/${entry.jobId}`, {
          headers,
        });
        expect(jobRes.ok()).toBeTruthy();
        const job = (await jobRes.json()) as { status: string; model: string };
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          jobModel = job.model;
        }
        return job.status;
      },
      { timeout: 20_000, message: 'prompt job should reach a terminal status' },
    )
    .toMatch(/^(COMPLETED|FAILED)$/);
  expect(jobModel).toBe('flash-lite');

  const list = await page.request.get(`${API}/agent/automations`, { headers });
  expect(list.ok()).toBeTruthy();
  const automations = (await list.json()) as {
    automations: Array<{ name: string; model: string | null }>;
  };
  expect(automations.automations.find((row) => row.name === savedName)?.model).toBe(
    'flash',
  );
});

test('opens the event form with a trailing-space command and creates nothing', async ({
  page,
}) => {
  await signIn(page);
  const headers = await auth(page);
  const before = await page.request.get(`${API}/agent/automations`, { headers });
  const beforeNames = ((await before.json()) as { automations: Array<{ name: string }> })
    .automations.map((row) => row.name);

  const composer = page.getByLabel('Ask the clerk to do something');
  await composer.fill('/event ');
  await composer.press('Enter');

  const panel = page.locator('#agent-panel-automations');
  await expect(panel.getByLabel('Trigger')).toHaveValue('EVENT');
  await expect(panel.getByLabel('Event')).toBeVisible();
  await expect(panel.getByLabel('Name')).toBeFocused();
  await expect(composer).toHaveValue('');

  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByLabel('Name')).toHaveCount(0);

  const after = await page.request.get(`${API}/agent/automations`, { headers });
  const afterNames = ((await after.json()) as { automations: Array<{ name: string }> })
    .automations.map((row) => row.name);
  expect(afterNames).toEqual(beforeNames);
});

test('shows a clear message for unknown commands without sending a prompt', async ({
  page,
}) => {
  await signIn(page);
  const composer = page.getByLabel('Ask the clerk to do something');
  const transcript = page.getByRole('log', { name: 'Conversation with the clerk' });

  await composer.fill('/bogus ');
  await composer.press('Enter');

  await expect(page.getByRole('status').filter({ hasText: 'Unknown command' })).toContainText(
    'Unknown command. Try /model, /cron, or /event.',
  );
  await expect(composer).toHaveValue('');
  await expect(transcript).not.toContainText('/bogus');
});

test('a viewer cannot open the automation form from a slash command', async ({ page }) => {
  await signIn(page, 'viewer@acme.test');
  const composer = page.getByLabel('Ask the clerk to do something');

  await composer.fill('/cron');
  await composer.press('Enter');

  await expect(
    page.getByRole('status').filter({ hasText: 'Only an Owner, Admin, Accountant, or Staff' }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Ask' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(composer).toHaveValue('');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('stops the composer red-ink pulse', async ({ page }) => {
    await signIn(page);
    const composerBox = page.locator('.composer__box');
    const styles = await composerBox.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return {
        animationName: computed.animationName,
        animationDuration: computed.animationDuration,
      };
    });
    expect(styles.animationName).toBe('none');
  });
});
