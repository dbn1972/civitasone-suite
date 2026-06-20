import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
    await page.goto('/dashboard');
  });

  test('shows module navigation tiles', async ({ page }) => {
    // Target h3 headings inside tiles to avoid strict-mode conflict with sidebar nav links
    await expect(page.getByRole('heading', { name: 'Finance', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HR & Payroll', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Procurement', level: 3 })).toBeVisible();
  });

  test('clicking Finance tile navigates to /finance', async ({ page }) => {
    // Tile accessible name includes the description — use partial match to avoid sidebar conflict
    await page.getByRole('link', { name: /Finance Budgets/ }).click();
    await expect(page).toHaveURL(/\/finance/);
  });

  test('clicking Tenant Admin tile navigates to /tenant-admin', async ({ page }) => {
    await page.getByRole('link', { name: /Tenant Admin Users/ }).click();
    await expect(page).toHaveURL(/\/tenant-admin/);
  });
});
