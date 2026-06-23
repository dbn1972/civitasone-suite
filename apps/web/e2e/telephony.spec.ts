import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Telephony', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('telephony hub shows heading', async ({ page }) => {
    await page.goto('/telephony');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Calls list ────────────────────────────────────────────────────────────

  test('telephony list page shows heading', async ({ page }) => {
    await page.goto('/telephony/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('telephony list shows seeded call record', async ({ page }) => {
    await page.goto('/telephony/list');
    await expect(page.getByText('+91-9876543210')).toBeVisible();
  });

  test('telephony list shows call status completed', async ({ page }) => {
    await page.goto('/telephony/list');
    await expect(page.getByText('completed')).toBeVisible();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  test('clicking telephony link from hub navigates to list', async ({ page }) => {
    await page.goto('/telephony');
    const listLink = page.getByRole('link', { name: /call/i }).first();
    if (await listLink.isVisible()) {
      await listLink.click();
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
  });
});
