import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Plugins', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Plugins page ──────────────────────────────────────────────────────────

  test('plugins page shows Plugins heading', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible();
  });

  test('plugins page shows plugin toggle cards', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByText('PFMS Connector')).toBeVisible();
  });

  test('plugins page shows enabled plugin status', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByText('enabled')).toBeVisible();
  });

  test('plugins page shows disabled plugin Aadhaar eSign', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByText('Aadhaar eSign')).toBeVisible();
    await expect(page.getByText('disabled')).toBeVisible();
  });

  test('plugins page shows description', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByText(/plugin/i).first()).toBeVisible();
  });
});
