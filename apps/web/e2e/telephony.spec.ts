import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Telephony', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('telephony list page loads', async ({ page }) => {
    await page.goto('/telephony/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
