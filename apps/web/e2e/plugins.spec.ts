import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Plugins', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('plugins list page loads', async ({ page }) => {
    await page.goto('/plugins/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
