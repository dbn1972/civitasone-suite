import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Assets', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/assets');
    await expect(page.getByRole('link', { name: 'Asset Register' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fixed Assets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Infrastructure' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Maintenance' })).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('asset dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/assets/dashboard');
    await expect(page.getByText('Total Assets')).toBeVisible();
    await expect(page.getByText('Under Maintenance')).toBeVisible();
    await expect(page.getByText('Net Block')).toBeVisible();
  });

  // ── List ─────────────────────────────────────────────────────────────────

  test('asset register shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/list');
    await expect(page.getByRole('heading', { name: 'Asset Register' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Asset Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Purchase Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Purchase Cost (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Current Value (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Location' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Dept' })).toBeVisible();
  });

  test('asset register shows seeded asset AST-001', async ({ page }) => {
    await page.goto('/assets/list');
    await expect(page.getByRole('cell', { name: 'AST-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Dell Laptop' })).toBeVisible();
  });

  // ── Detail ───────────────────────────────────────────────────────────────

  test('asset detail shows asset name and details', async ({ page }) => {
    await page.goto('/assets/ast-001');
    await expect(page.getByRole('heading', { name: 'Dell Laptop XPS 15' })).toBeVisible();
    await expect(page.getByText('AST-001')).toBeVisible();
  });

  test('asset detail breadcrumb links back to register', async ({ page }) => {
    await page.goto('/assets/ast-001');
    await expect(page.getByRole('link', { name: 'Assets' })).toBeVisible();
  });

  test('navigating list → detail shows asset detail', async ({ page }) => {
    await page.goto('/assets/list');
    await page.getByRole('link', { name: 'AST-001' }).click();
    await expect(page.getByRole('heading', { name: 'Dell Laptop XPS 15' })).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('fixed assets shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/fixed-assets');
    await expect(page.getByRole('heading', { name: 'Fixed Assets' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Asset Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('infrastructure assets shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/infra');
    await expect(page.getByRole('heading', { name: 'Infrastructure Assets' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Asset Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Condition' })).toBeVisible();
  });

  test('asset maintenance shows heading and seeded maintenance record', async ({ page }) => {
    await page.goto('/assets/maintenance');
    await expect(page.getByRole('heading', { name: 'Asset Maintenance' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Asset Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Maintenance Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });
});
