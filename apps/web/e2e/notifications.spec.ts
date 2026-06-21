import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('notifications list page loads', async ({ page }) => {
    await page.goto('/notifications/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
