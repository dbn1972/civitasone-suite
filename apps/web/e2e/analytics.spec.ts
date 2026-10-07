import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('analytics hub shows heading and navigation link', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Data & Analytics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboards', exact: true })).toBeVisible();
  });

  test('analytics hub nav link points to the dashboards page', async ({ page }) => {
    // GAP-ANALYTICS-HOME-01: the "/analytics/list" legacy tile was removed; the
    // hub's "Dashboards" tile is the one entry point to the dashboards view.
    await page.goto('/analytics');
    await expect(page.getByRole('main').getByRole('link', { name: /^Dashboards/ })).toHaveAttribute('href', '/analytics/dashboards');
  });

  test('legacy /analytics/list redirects to the dashboards page', async ({ page }) => {
    // GAP-ANALYTICS-LIST-01: kept so existing bookmarks still work.
    await page.goto('/analytics/list');
    await expect(page).toHaveURL(/\/analytics\/dashboards$/);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible();
  });

  test('analytics dashboards page shows heading', async ({ page }) => {
    await page.goto('/analytics/dashboards');
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible();
  });

  test('analytics dashboards table shows its column headers', async ({ page }) => {
    await page.goto('/analytics/dashboards');
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Description' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Visibility' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Version' })).toBeVisible();
  });

  test('analytics dashboards table shows the seeded dashboard', async ({ page }) => {
    await page.goto('/analytics/dashboards');
    await expect(page.getByText('Finance KPI Dashboard')).toBeVisible();
  });

  test('analytics hub navigates to the dashboards page on link click', async ({ page }) => {
    await page.goto('/analytics');
    await page.getByRole('main').getByRole('link', { name: /^Dashboards/ }).click();
    await expect(page).toHaveURL(/\/analytics\/dashboards$/);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible();
  });
});
