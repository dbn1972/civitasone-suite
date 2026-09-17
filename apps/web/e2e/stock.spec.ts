import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// REL-023: the Stock module was permanently consolidated into Inventory
// (next.config.mjs redirects(): "Legacy /stock/* routes -> /inventory/*
// (requirement 1.7)"). Every /stock/* page.tsx under src/app/(app)/stock is
// now unreachable dead code — Next.js applies redirects() before matching
// any page file, production build or not — so this file's original
// assertions (hub links, dashboard KPIs, list columns, item detail) were all
// testing content a real browser can never reach. Current, meaningful
// coverage for the module's actual UI now belongs to inventory.spec.ts; this
// file is repurposed as regression coverage for the redirect map itself
// (easy to silently break, e.g. by adding a new /stock page file that
// shadows the wildcard rule) plus the one piece of real UI that has no other
// test coverage post-migration: the per-item detail page (relocated to
// apps/web/src/app/(app)/inventory/[id]/page.tsx as part of this same
// tranche — see that file's own header comment for the 404 regression this
// fixes: every row-link and "back" link under Inventory still pointed at
// /stock/<id>, which the wildcard rule sent to /inventory/<id> — a route
// that, until this tranche, did not exist).
test.describe('Stock (legacy /stock/* redirects)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('/stock redirects to the Inventory hub', async ({ page }) => {
    await page.goto('/stock');
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/stock/dashboard redirects to the Inventory hub', async ({ page }) => {
    await page.goto('/stock/dashboard');
    await expect(page).toHaveURL(/\/inventory$/);
  });

  test('/stock/list redirects to the Inventory list', async ({ page }) => {
    await page.goto('/stock/list');
    await expect(page).toHaveURL(/\/inventory\/list$/);
    await expect(page.getByRole('heading', { name: 'Stock Items', level: 1 })).toBeVisible();
  });

  test('/stock/ledger redirects to Inventory reconcile', async ({ page }) => {
    await page.goto('/stock/ledger');
    await expect(page).toHaveURL(/\/inventory\/reconcile$/);
  });

  test('/stock/<id> (wildcard rule) redirects to /inventory/<id>', async ({ page }) => {
    await page.goto('/stock/sku-001');
    await expect(page).toHaveURL(/\/inventory\/sku-001$/);
  });

  // ── Item detail (relocated to /inventory/[id]) ────────────────────────────

  test('stock item detail shows item name and details section', async ({ page }) => {
    await page.goto('/stock/sku-001');
    await expect(page.getByRole('heading', { name: 'A4 Paper Ream', level: 1 })).toBeVisible();
    await expect(page.getByText('Details')).toBeVisible();
    await expect(page.getByText('On-hand qty')).toBeVisible();
  });

  test('stock item detail has a back link to the inventory list', async ({ page }) => {
    await page.goto('/stock/sku-001');
    await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/inventory/list');
  });

  test('stock item detail shows ledger section', async ({ page }) => {
    await page.goto('/stock/sku-001');
    await expect(page.getByRole('heading', { name: 'Stock ledger' })).toBeVisible();
  });

  test('stock item detail ledger has type column', async ({ page }) => {
    await page.goto('/stock/sku-001');
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
  });

  test('navigating inventory list → item detail preserves heading context', async ({ page }) => {
    await page.goto('/inventory/list');
    await page.getByText('A4 Paper Ream').first().click();
    await expect(page).toHaveURL(/\/inventory\/sku-001$/);
    await expect(page.getByRole('heading', { name: 'A4 Paper Ream', level: 1 })).toBeVisible();
  });
});
