import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('inventory reconcile page loads', async ({ page }) => {
    await page.goto('/inventory/reconcile');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
