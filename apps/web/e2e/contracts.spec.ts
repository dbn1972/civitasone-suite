import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Contracts', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('contracts hub shows navigation link to contracts list', async ({ page }) => {
    await page.goto('/contracts');
    await expect(page.getByRole('link', { name: 'Contracts' })).toBeVisible();
  });

  // ── Contracts list ────────────────────────────────────────────────────────

  test('contracts list page shows heading', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('contracts list shows seeded contract CON/2024/001', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByText('CON/2024/001')).toBeVisible();
  });

  test('contracts list shows vendor name Tech Corp', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByText('Tech Corp')).toBeVisible();
  });

  test('contracts list shows contract title Annual AMC', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByText(/Annual AMC/)).toBeVisible();
  });

  // ── Navigation from hub ───────────────────────────────────────────────────

  test('clicking Contracts link from hub navigates to contracts list', async ({ page }) => {
    await page.goto('/contracts');
    await page.getByRole('link', { name: 'Contracts' }).click();
    await expect(page).toHaveURL(/\/contracts\/list/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
