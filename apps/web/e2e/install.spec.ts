import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Install', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('install wizard page loads', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
