import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Themes', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Themes page ───────────────────────────────────────────────────────────

  test('themes page shows Themes heading', async ({ page }) => {
    await page.goto('/themes');
    await expect(page.getByRole('heading', { name: 'Themes' })).toBeVisible();
  });

  test('themes page shows token keys from mock API', async ({ page }) => {
    await page.goto('/themes');
    await expect(page.getByText('--color-primary')).toBeVisible();
  });

  test('themes page shows token values from mock API', async ({ page }) => {
    await page.goto('/themes');
    await expect(page.getByText('#0052cc')).toBeVisible();
  });

  test('themes page shows multiple theme tokens', async ({ page }) => {
    await page.goto('/themes');
    await expect(page.getByText('--color-secondary')).toBeVisible();
    await expect(page.getByText('--font-family')).toBeVisible();
  });

  test('themes page shows description text', async ({ page }) => {
    await page.goto('/themes');
    await expect(page.getByText(/branding|token/i).first()).toBeVisible();
  });
});
