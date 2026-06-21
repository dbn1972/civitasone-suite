import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Stock', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/stock');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stock List' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stock Ledger' })).toBeVisible();
  });

  test('dashboard shows heading and KPI cards', async ({ page }) => {
    await page.goto('/stock/dashboard');
    await expect(page.getByRole('heading', { name: 'Stock & Inventory' })).toBeVisible();
    await expect(page.getByText('Total SKUs')).toBeVisible();
    await expect(page.getByText('Low Stock Alerts')).toBeVisible();
    await expect(page.getByText('GRNs This Month')).toBeVisible();
    await expect(page.getByText('Inventory Value (₹)')).toBeVisible();
  });

  test('dashboard KPI shows non-zero total SKUs from seeded data', async ({ page }) => {
    await page.goto('/stock/dashboard');
    // totalSKUs > 0 — the displayed value should not be "0"
    const totalSkusCard = page.locator('div').filter({ hasText: /^Total SKUs$/ }).locator('+ p');
    await expect(totalSkusCard).not.toHaveText('0');
  });

  test('stock list shows heading and column headers', async ({ page }) => {
    await page.goto('/stock/list');
    await expect(page.getByRole('heading', { name: 'Stock Items' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Item Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unit' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Current Stock' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Min Level' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unit Cost (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total Value (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Warehouse' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('stock list shows seeded item SKU-001', async ({ page }) => {
    await page.goto('/stock/list');
    await expect(page.getByRole('cell', { name: 'SKU-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'A4 Paper' })).toBeVisible();
  });

  test('stock ledger shows heading and column headers', async ({ page }) => {
    await page.goto('/stock/ledger');
    await expect(page.getByRole('heading', { name: 'Stock Ledger' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Item Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Item Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Quantity' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unit Cost (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total Value (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Party' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Balance' })).toBeVisible();
  });
});
