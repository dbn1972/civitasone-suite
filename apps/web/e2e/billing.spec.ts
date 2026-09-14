import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Billing', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('billing hub shows heading and navigation link', async ({ page }) => {
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
  });

  test('billing hub nav link points to the plans page', async ({ page }) => {
    // The hub tile now links straight to the new rich /billing/plans page
    // instead of the old generic /billing/list ModuleListPage (which still
    // exists and is exercised directly by the two tests below, just no
    // longer reachable from the hub).
    await page.goto('/billing');
    await expect(page.getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/billing/plans');
  });

  test('billing plans list page shows heading', async ({ page }) => {
    await page.goto('/billing/list');
    await expect(page.getByRole('heading', { name: 'Billing — Plans' })).toBeVisible();
  });

  test('billing plans list shows ModuleListPage column headers', async ({ page }) => {
    await page.goto('/billing/list');
    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Detail' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Meta' })).toBeVisible();
  });

  test('billing hub navigates to the plans page on link click', async ({ page }) => {
    // Destination changed from /billing/list to /billing/plans (see nav-link
    // test above); both pages happen to share the same "Billing — Plans"
    // heading, so only the URL expectation needs updating.
    await page.goto('/billing');
    await page.getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/billing\/plans/);
    await expect(page.getByRole('heading', { name: 'Billing — Plans' })).toBeVisible();
  });
});
