import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('inventory hub shows heading', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Inventory list ────────────────────────────────────────────────────────

  test('inventory list page shows heading Inventory Items', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByRole('heading', { name: 'Inventory Items' })).toBeVisible();
  });

  test('inventory list shows Total SKUs KPI card', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByText('Total SKUs')).toBeVisible();
  });

  test('inventory list shows Low Stock KPI card', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByText('Low Stock')).toBeVisible();
  });

  test('inventory list shows stock items from mock API', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByText('A4 Paper Ream')).toBeVisible();
  });

  test('inventory list shows link to stock register', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByRole('link', { name: /stock register/i })).toBeVisible();
  });

  // ── Reconcile ─────────────────────────────────────────────────────────────

  test('inventory reconcile page shows heading', async ({ page }) => {
    await page.goto('/inventory/reconcile');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('clicking stock register link navigates to /stock/list', async ({ page }) => {
    await page.goto('/inventory/list');
    await page.getByRole('link', { name: /stock register/i }).click();
    await expect(page).toHaveURL(/\/stock\/list/);
  });
});
