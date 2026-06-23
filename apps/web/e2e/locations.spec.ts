import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Locations', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('locations hub shows navigation link to locations list', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.getByRole('link', { name: /location/i }).first()).toBeVisible();
  });

  // ── Locations list ────────────────────────────────────────────────────────

  test('locations list page shows heading', async ({ page }) => {
    await page.goto('/locations/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('locations list shows seeded location HQ Delhi', async ({ page }) => {
    await page.goto('/locations/list');
    await expect(page.getByText('HQ Delhi')).toBeVisible();
  });

  test('locations list shows location type office', async ({ page }) => {
    await page.goto('/locations/list');
    await expect(page.getByText('office')).toBeVisible();
  });

  test('locations list shows active status', async ({ page }) => {
    await page.goto('/locations/list');
    await expect(page.getByText('active')).toBeVisible();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('clicking locations link from hub navigates to list', async ({ page }) => {
    await page.goto('/locations');
    await page.getByRole('link', { name: /location/i }).first().click();
    await expect(page).toHaveURL(/\/locations\/list/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
