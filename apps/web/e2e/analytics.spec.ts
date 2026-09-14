import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('analytics hub shows heading and navigation link', async ({ page }) => {
    // The hub now has two tiles whose titles both start with "Dashboards"
    // ("Dashboards" -- saved dashboards -- and "Dashboards (legacy list)"),
    // so a loose match resolves to both (strict-mode violation). exact: true
    // targets the new primary tile's <h3> specifically.
    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Data & Analytics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboards', exact: true })).toBeVisible();
  });

  test('analytics hub nav link points to dashboards list', async ({ page }) => {
    // This test is about the legacy /analytics/list route specifically (see
    // the ModuleListPage assertions below), so target the tile titled
    // "Dashboards (legacy list)" rather than the new "Dashboards" tile that
    // now also matches a loose "Dashboards" name.
    await page.goto('/analytics');
    await expect(page.getByRole('link', { name: /legacy list/i })).toHaveAttribute('href', '/analytics/list');
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
    // Same disambiguation as the nav-link test above -- click the legacy-list
    // tile specifically, not the new "Dashboards" tile that also matches a
    // loose name.
    await page.goto('/analytics');
    await page.getByRole('link', { name: /legacy list/i }).click();
    await expect(page).toHaveURL(/\/analytics\/list/);
    await expect(page.getByRole('heading', { name: 'Analytics — Dashboards' })).toBeVisible();
  });
});
