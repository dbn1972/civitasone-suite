import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    await page.goto('/dashboard');
  });

  test('shows module navigation tiles', async ({ page }) => {
    // Tiles are <Link aria-label={label}> wrapping a stat card; the label is the
    // accessible name of the link. Sidebar nav also has module links so we use
    // first() to avoid strict-mode conflicts when both match.
    await expect(page.getByRole('link', { name: 'Finance' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'HR & Payroll' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Procurement' }).first()).toBeVisible();
  });

  test('clicking Finance tile navigates to /finance', async ({ page }) => {
    // The dashboard nav renders links with aria-label matching the module label.
    // Use the one inside the modules <nav aria-label="Modules"> to avoid sidebar.
    await page.locator('[aria-label="Modules"]').getByRole('link', { name: 'Finance' }).click();
    await expect(page).toHaveURL(/\/finance/);
  });

  test('clicking Tenant Admin tile navigates to /tenant-admin', async ({ page }) => {
    await page.locator('[aria-label="Modules"]').getByRole('link', { name: 'Tenant Admin' }).click();
    await expect(page).toHaveURL(/\/tenant-admin/);
  });
});
