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

  test('billing hub nav link points to plans list', async ({ page }) => {
    await page.goto('/billing');
    await expect(page.getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/billing/list');
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

  test('billing hub navigates to plans list on link click', async ({ page }) => {
    await page.goto('/billing');
    await page.getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/billing\/list/);
    await expect(page.getByRole('heading', { name: 'Billing — Plans' })).toBeVisible();
  });
});
