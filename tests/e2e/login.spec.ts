import { expect, test } from '@playwright/test';

test('seeded owner can sign in, keep the session, and sign out', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: /Overview/ })).toBeVisible();
  await expect(page.getByText('Olive Owner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acme Services Co.' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: /Overview/ })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@acme.test');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('demo account row fills the form and signs in', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /owner@acme\.test/ }).click();

  await expect(page.getByLabel('Email')).toHaveValue('owner@acme.test');
  await expect(page.getByLabel('Password')).toBeFocused();

  await page.getByLabel('Password').fill('Passw0rd!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: /Overview/ })).toBeVisible();
});
