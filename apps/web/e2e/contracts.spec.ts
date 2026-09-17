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

  test('contracts list shows vendor ID', async ({ page }) => {
    // mapContractsListRows (loaders.ts) is deliberate about this: contract-
    // service exposes only a raw vendorId, with no joined vendor display
    // name today (see the mapper's own comment / PR #813 fixup), so the
    // "Vendor ID" column shows the fixture's vendorId -- a human vendor
    // *name* like "Tech Corp" is never rendered anywhere in this table.
    await page.goto('/contracts/list');
    await expect(page.getByText('VEN-TECHCORP-001')).toBeVisible();
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
