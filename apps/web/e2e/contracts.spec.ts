import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Contracts', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('contracts list page loads', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
