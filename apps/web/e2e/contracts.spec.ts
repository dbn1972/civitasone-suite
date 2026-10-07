import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Contracts', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('contracts hub shows navigation link to contracts list', async ({ page }) => {
    await page.goto('/contracts');
    // href-scoped: the hub also has a "Rate Contracts" tile, whose label
    // itself contains "Contracts", so a loose name search on this tile's own
    // label ("Contracts") resolves to both (strict-mode violation).
    await expect(page.locator('a.mtile[href="/contracts/list"]')).toBeVisible();
  });

  // ── Contracts list ────────────────────────────────────────────────────────

  test('contracts list page shows heading', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('contracts list shows seeded contract CON/2024/001', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByText('CON/2024/001')).toBeVisible();
  });

  test('contracts list shows the resolved vendor name', async ({ page }) => {
    // GAP-CONTRACTS-LIST-01: contract-service only stores a raw vendorId; the list resolves
    // the display name from the procurement vendor master (getVendorOptions) and never prints
    // the raw id -- an id with no match reads "Unknown vendor". The fixture contract points at
    // the seeded vendor 'Bharat Electronics' (see global-setup.ts).
    await page.goto('/contracts/list');
    await expect(page.getByText('Bharat Electronics')).toBeVisible();
  });

  test('contracts list shows contract title Annual AMC', async ({ page }) => {
    await page.goto('/contracts/list');
    await expect(page.getByText(/Annual AMC/)).toBeVisible();
  });

  // ── Navigation from hub ───────────────────────────────────────────────────

  test('clicking Contracts link from hub navigates to contracts list', async ({ page }) => {
    await page.goto('/contracts');
    await page.locator('a.mtile[href="/contracts/list"]').click();
    await expect(page).toHaveURL(/\/contracts\/list/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
