import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('analytics hub shows heading and navigation link', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Data & Analytics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboards' })).toBeVisible();
  });

  test('analytics hub nav link points to dashboards list', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByRole('link', { name: 'Dashboards' })).toHaveAttribute('href', '/analytics/list');
  });

  test('analytics dashboards list page shows heading', async ({ page }) => {
    await page.goto('/analytics/list');
    await expect(page.getByRole('heading', { name: 'Analytics — Dashboards' })).toBeVisible();
  });

  test('analytics dashboards list shows ModuleListPage column headers', async ({ page }) => {
    await page.goto('/analytics/list');
    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Detail' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Meta' })).toBeVisible();
  });

  test('analytics hub navigates to dashboards list on link click', async ({ page }) => {
    await page.goto('/analytics');
    await page.getByRole('link', { name: 'Dashboards' }).click();
    await expect(page).toHaveURL(/\/analytics\/list/);
    await expect(page.getByRole('heading', { name: 'Analytics — Dashboards' })).toBeVisible();
  });
});
