import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Locations', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('locations list page loads', async ({ page }) => {
    await page.goto('/locations/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
