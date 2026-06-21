import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Knowledge', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('knowledge hub shows heading and navigation links', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge & DMS' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Repository' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Records Management' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  });

  test('knowledge hub nav links point to correct hrefs', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.locator('a[href="/knowledge/repository"]')).toBeVisible();
    await expect(page.locator('a[href="/knowledge/records"]')).toBeVisible();
    await expect(page.locator('a[href="/knowledge/search"]')).toBeVisible();
  });

  test('documents list page shows heading and column headers', async ({ page }) => {
    await page.goto('/knowledge/list');
    await expect(page.getByRole('heading', { name: 'Knowledge — Documents' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Doc ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Author' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Version' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Access' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('documents list page shows seeded document data', async ({ page }) => {
    await page.goto('/knowledge/list');
    const table = page.getByRole('table', { name: 'Knowledge documents' });
    await expect(table.getByRole('cell', { name: 'Procurement Policy 2024' })).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Policy', exact: true })).toBeVisible();
  });

  test('records management page shows heading and column headers', async ({ page }) => {
    await page.goto('/knowledge/records');
    await expect(page.getByRole('heading', { name: 'Records Management' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Record No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Retention Period' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('knowledge search page loads', async ({ page }) => {
    await page.goto('/knowledge/search');
    // SearchClient renders a search interface; verify the page loads without error
    await expect(page).not.toHaveURL(/error/);
    await expect(page.locator('body')).toBeVisible();
  });
});
