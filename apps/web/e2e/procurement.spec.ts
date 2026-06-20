import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Procurement', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('vendor list shows column headers including GSTIN', async ({ page }) => {
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GSTIN' })).toBeVisible();
  });

  test('vendor list shows vendor name from mock API', async ({ page }) => {
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('link', { name: 'Tech Supplies Ltd' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '29ABCDE1234F1Z5' })).toBeVisible();
  });

  test('purchase orders page loads without error', async ({ page }) => {
    await page.goto('/procurement/orders');
    await expect(page.getByRole('heading', { name: /orders/i })).toBeVisible();
  });

  test('approvals page renders without error', async ({ page }) => {
    await page.goto('/procurement/approvals');
    await expect(page.getByRole('heading', { name: /approval/i })).toBeVisible();
  });
});
