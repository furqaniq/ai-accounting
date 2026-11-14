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
  await expect(menu.locator('.org__members')).toContainText('4 members');

  await menu.getByRole('button', { name: /Nimbus Retail LLC/ }).click();

  const switched = page.getByRole('button', { name: /Nimbus Retail LLC/ });
  await expect(switched).toBeVisible();
  await expect(switched).toContainText('Accountant');
  await expect(page).toHaveURL(/\/$/);

  await switched.click();
  await expect(page.locator('#org-menu .org__members')).toContainText('3 members');
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('button', { name: /Nimbus Retail LLC/ })).toBeVisible();
});
