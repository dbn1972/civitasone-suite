import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('workflow hub shows heading and navigation link', async ({ page }) => {
    await page.goto('/workflow');
    await expect(page.getByRole('heading', { name: 'Workflow & BPM' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Instances' })).toBeVisible();
  });

  test('workflow hub nav link points to instances list', async ({ page }) => {
    await page.goto('/workflow');
    await expect(page.getByRole('link', { name: 'Instances' })).toHaveAttribute('href', '/workflow/list');
  });

  test('workflow instances list page shows heading', async ({ page }) => {
    await page.goto('/workflow/list');
    await expect(page.getByRole('heading', { name: 'Workflow — Instances' })).toBeVisible();
  });

  // REL-023 tranche 6: this page never used the generic ModuleListPage
  // (ID/Name/Detail/Status/Meta) template -- InstancesTable
  // (workflow/_components/InstancesTable.tsx) is its own bespoke
  // DataTable wrapper with a different, fixed column set. Renamed to
  // describe what's actually asserted and updated to the real headers.
  test('workflow instances list shows its own table column headers', async ({ page }) => {
    await page.goto('/workflow/list');
    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Instance' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Version' })).toBeVisible();
  });

  test('workflow hub navigates to instances list on link click', async ({ page }) => {
    await page.goto('/workflow');
    await page.getByRole('link', { name: 'Instances' }).click();
    await expect(page).toHaveURL(/\/workflow\/list/);
    await expect(page.getByRole('heading', { name: 'Workflow — Instances' })).toBeVisible();
  });
});
