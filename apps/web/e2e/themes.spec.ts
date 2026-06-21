import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Themes', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('themes list page loads', async ({ page }) => {
    await page.goto('/themes/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
