import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('reports hub shows heading and navigation links', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
    await expect(page.locator('a[href="/reports/dashboard"]')).toBeVisible();
    await expect(page.locator('a[href="/reports/list"]')).toBeVisible();
    await expect(page.locator('a[href="/reports/kpi"]')).toBeVisible();
    await expect(page.locator('a[href="/reports/mis"]')).toBeVisible();
  });

  test('reports hub nav links point to correct hrefs', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('link', { name: 'Report Jobs' })).toHaveAttribute('href', '/reports/list');
    await expect(page.getByRole('link', { name: 'KPI Tracker' })).toHaveAttribute('href', '/reports/kpi');
    await expect(page.getByRole('link', { name: 'MIS Dashboard' })).toHaveAttribute('href', '/reports/mis');
  });

  test('report jobs list page shows heading and column headers', async ({ page }) => {
    await page.goto('/reports/list');
    // level:1 disambiguates the page h1 from a card's own "Report jobs" h3
    // that repeats the page heading text.
    await expect(page.getByRole('heading', { name: 'Report Jobs', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Report Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Module' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Requested By' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Format' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Download' })).toBeVisible();
  });

  test('report jobs list shows seeded job data', async ({ page }) => {
    await page.goto('/reports/list');
    // The table has no accessible name (no aria-label/caption on the shared
    // DataTable instance here) -- matching the plain, unscoped getByRole('cell')
    // pattern the KPI test below already uses for the same reason.
    await expect(page.getByRole('cell', { name: 'Monthly Finance Summary' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'finance', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'completed', exact: true })).toBeVisible();
  });

  test('KPI tracker page shows heading and column headers', async ({ page }) => {
    await page.goto('/reports/kpi');
    // level:1 disambiguates the page h1 from a card's own "KPI monitoring" h3
    // that repeats the page heading text.
    await expect(page.getByRole('heading', { name: 'KPI Monitoring', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'KPI' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Owner Module' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unit' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Period' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('KPI tracker shows seeded KPI data', async ({ page }) => {
    await page.goto('/reports/kpi');
    await expect(page.getByRole('cell', { name: 'Budget Utilization' })).toBeVisible();
  });

  test('MIS dashboard page shows heading', async ({ page }) => {
    await page.goto('/reports/mis');
    await expect(page.getByRole('heading', { name: 'Management Information System' })).toBeVisible();
  });

  test('reports hub navigates to report jobs list on link click', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('link', { name: 'Report Jobs' }).click();
    await expect(page).toHaveURL(/\/reports\/list/);
    // level:1 disambiguates the page h1 from a card's own "Report jobs" h3
    // that repeats the page heading text.
    await expect(page.getByRole('heading', { name: 'Report Jobs', level: 1 })).toBeVisible();
  });
});
