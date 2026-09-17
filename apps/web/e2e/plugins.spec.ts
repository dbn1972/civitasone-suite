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

  // /plugins is now a ModuleHub (Installed/Marketplace/Hooks/Registry tiles,
  // like the assets/contracts/locations hubs) -- the actual per-plugin
  // enable/disable toggle cards these three tests check for live one level
  // down, at /plugins/installed.

  test('plugins page shows plugin toggle cards', async ({ page }) => {
    await page.goto('/plugins/installed');
    await expect(page.getByText('PFMS Connector')).toBeVisible();
  });

  test('plugins page shows enabled plugin status', async ({ page }) => {
    await page.goto('/plugins/installed');
    // Table-scoped: the "Enabled" KPI stat-card label reads the same as the
    // per-row status pill this test actually means to check.
    await expect(page.getByRole('table').getByText('Enabled')).toBeVisible();
  });

  test('plugins page shows disabled plugin Aadhaar eSign', async ({ page }) => {
    await page.goto('/plugins/installed');
    await expect(page.getByText('Aadhaar eSign')).toBeVisible();
    // Table-scoped -- same KPI-label collision as the enabled test above.
    await expect(page.getByRole('table').getByText('Disabled')).toBeVisible();
  });

  test('plugins page shows description', async ({ page }) => {
    await page.goto('/plugins');
    await expect(page.getByText(/plugin/i).first()).toBeVisible();
  });
});
