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

  test('grants list shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/list');
    await expect(page.getByRole('heading', { name: 'Grants' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grant No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grantee' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total Amount (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Disbursed (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Pending (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Sanction Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('grants list shows seeded grant GRANT-001', async ({ page }) => {
    await page.goto('/grants/list');
    await expect(page.getByRole('cell', { name: 'GRANT-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Rural Water Supply' })).toBeVisible();
  });

  test('grantees page shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/grantees');
    await expect(page.getByRole('heading', { name: 'Grantees' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grantee Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Registration No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Active Grants' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total Received (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'UC Compliance' })).toBeVisible();
  });

  test('grant installments page shows heading and column headers', async ({ page }) => {
    await page.goto('/grants/installments');
    await expect(page.getByRole('heading', { name: 'Grant Installments' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grant No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Grantee' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Installment No' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Amount (₹)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Scheduled Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Released Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });
});
