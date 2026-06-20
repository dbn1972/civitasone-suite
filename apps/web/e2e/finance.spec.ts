import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Finance', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('chart of accounts shows table column headers', async ({ page }) => {
    await page.goto('/finance/chart-of-accounts');
    await expect(page.getByRole('heading', { name: 'Chart of Accounts' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Code' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  });

  test('chart of accounts lists accounts from mock API', async ({ page }) => {
    await page.goto('/finance/chart-of-accounts');
    await expect(page.getByRole('cell', { name: '1001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Cash' })).toBeVisible();
  });

  test('payments list shows table column headers', async ({ page }) => {
    await page.goto('/finance/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Reference' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Beneficiary' })).toBeVisible();
  });

  test('payments list shows payment reference and status', async ({ page }) => {
    await page.goto('/finance/payments');
    await expect(page.getByRole('cell', { name: 'PAY-001' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Queued' })).toBeVisible();
  });

  test('journal entry page renders heading', async ({ page }) => {
    await page.goto('/finance/journal-entry');
    await expect(page.getByRole('heading', { name: /journal entry/i })).toBeVisible();
  });
});
