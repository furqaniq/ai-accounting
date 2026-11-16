import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const PROMPT = 'PW agent cash insight';

test.afterAll(() => {
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
        `DELETE FROM "AgentActionLog" WHERE "jobId" IN (SELECT id FROM "AgentJob" WHERE prompt = '${PROMPT}'); DELETE FROM "AgentJob" WHERE prompt = '${PROMPT}';`,
      ],
      { cwd: process.cwd(), stdio: 'ignore' },
    );
  } catch {
    // Cleanup is best-effort; the log is append-only in the app itself.
  }
});

test('owner asks Clerk a read-only cash question and sees the log entry', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.getByRole('link', { name: 'Clerk' }).click();
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole('heading', { name: 'Clerk', level: 1 })).toBeVisible();

  await page.getByLabel('Ask the clerk to do something').fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const transcript = page.getByRole('log', { name: 'Conversation with the clerk' });
  await expect(transcript).toContainText(PROMPT);
  await expect(transcript).toContainText(/Agent is busy, retrying|Reading the books|Queued/);

  await expect(transcript).toContainText('Cash across', { timeout: 20_000 });
  await expect(transcript).toContainText(/\$[0-9,]+\.[0-9]{2}/);

  const logLine = page.locator('.agent-log-line');
  await expect(logLine).toContainText(/AGT-\d{4,}/);
  await expect(logLine).toContainText('insight.query');

  await page.getByRole('tab', { name: 'Activity' }).click();
  const row = page
    .locator('#agent-panel-activity tbody tr', { hasText: 'insight.query' })
    .first();
  await expect(row).toContainText('Prompt');
  await expect(row).toContainText('Completed');
  await expect(row).toContainText(/AGT-\d{4,}/);

  await row.click();
  await expect(page.locator('.agent-detail')).toContainText('Output');
  await expect(page.locator('.agent-detail')).toContainText('Cash across');
  await expect(page.locator('.agent-detail')).toContainText(/AGT-\d{4,}/);
});
