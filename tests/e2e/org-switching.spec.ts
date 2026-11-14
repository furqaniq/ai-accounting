import { expect, test } from '@playwright/test';

test('a multi-org user switches organizations without re-login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const orgButton = page.getByRole('button', { name: /Acme Services Co\./ });
  await expect(orgButton).toBeVisible();
  await expect(orgButton).toContainText('Owner');

  await orgButton.click();
  const menu = page.locator('#org-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Nimbus Retail LLC');
  await expect(menu.getByRole('button', { name: /Members 4 members/ })).toBeVisible();

  await menu.getByRole('button', { name: /Nimbus Retail LLC/ }).click();

  const switched = page.getByRole('button', { name: /Nimbus Retail LLC/ });
  await expect(switched).toBeVisible();
  await expect(switched).toContainText('Accountant');
  await expect(page).toHaveURL(/\/$/);

  await switched.click();
  await expect(page.locator('#org-menu').getByRole('button', { name: /Members 3 members/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('button', { name: /Nimbus Retail LLC/ })).toBeVisible();
});
