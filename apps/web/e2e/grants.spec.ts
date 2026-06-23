import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Grants', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/grants');
    await expect(page.locator('a[href="/grants/list"]')).toBeVisible();
    await expect(page.locator('a[href="/grants/grantees"]')).toBeVisible();
    await expect(page.locator('a[href="/grants/installments"]')).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('grants dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/grants/dashboard');
    await expect(page.getByText(/grant/i).first()).toBeVisible();
  });

  // ── Grants list ───────────────────────────────────────────────────────────

  test('grants list shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/list');
    await expect(page.getByRole('heading', { name: 'Grants' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grant No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grantee' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total Amount (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('grants list shows seeded grant GRANT-001', async ({ page }) => {
    await page.goto('/grants/list');
    await expect(page.getByRole('cell', { name: 'GRANT-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Rural Water Supply' })).toBeVisible();
  });

  // ── Grant detail ──────────────────────────────────────────────────────────

  test('grant detail shows heading', async ({ page }) => {
    await page.goto('/grants/grn-001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('grant detail shows grant title', async ({ page }) => {
    await page.goto('/grants/grn-001');
    await expect(page.getByText('Rural Water Supply Scheme')).toBeVisible();
  });

  test('grant detail shows installments section', async ({ page }) => {
    await page.goto('/grants/grn-001');
    await expect(page.getByText(/installment/i)).toBeVisible();
  });

  test('navigating grants list → detail shows grant detail', async ({ page }) => {
    await page.goto('/grants/list');
    await page.getByRole('link', { name: 'GRANT-001' }).click();
    await expect(page.getByText('Rural Water Supply Scheme')).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('grantees page shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/grantees');
    await expect(page.getByRole('heading', { name: 'Grantees' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  });

  test('grant installments page shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/installments');
    await expect(page.getByRole('heading', { name: 'Grant Installments' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grant No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Amount (₹)' })).toBeVisible();
  });
});
