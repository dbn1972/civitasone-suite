import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  // ── Hub ───────────────────────────────────────────────────────────────────

  test('inventory hub shows heading', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  // ── Inventory list ────────────────────────────────────────────────────────

  test('inventory list page shows heading Stock Items', async ({ page }) => {
    await page.goto('/inventory/list');
    // REL-023: the page's own <h1> is "Stock Items" (PageHeader title in
    // inventory/list/page.tsx) — "Inventory Items" isn't used anywhere on
    // this page.
    await expect(page.getByRole('heading', { name: 'Stock Items' })).toBeVisible();
  });

  test('inventory list shows Total SKUs KPI card', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByText('Total SKUs')).toBeVisible();
  });

  test('inventory list shows Low Stock KPI card', async ({ page }) => {
    await page.goto('/inventory/list');
    // REL-023: the list grew an "All items / Low stock" segmented filter
    // (case-insensitively "Low stock" too), so the untargeted text query now
    // resolves to both the StatCard label and the filter tab.
    await expect(page.getByText('Low Stock', { exact: true })).toBeVisible();
  });

  test('inventory list shows stock items from mock API', async ({ page }) => {
    await page.goto('/inventory/list');
    await expect(page.getByText('A4 Paper Ream')).toBeVisible();
  });

  test('inventory list shows a Stock register card linking each item to /stock/<id>', async ({ page }) => {
    // REL-023: "shows link to stock register" / "clicking stock register
    // link navigates to /stock/list" (removed) tested a cross-link from
    // Inventory to a separate Stock page that no longer makes sense to have
    // now that /stock/list IS /inventory/list (permanently redirected, same
    // page) — Card's `link` prop here is the segmented filter control, not
    // an anchor, and there never was a literal "stock register" link on this
    // page after the consolidation. The register concept survives as this
    // card's own title, with each row still deep-linking out to the item
    // detail page (see stock.spec.ts for that route's own coverage).
    await page.goto('/inventory/list');
    await expect(page.getByText('Stock register')).toBeVisible();
  });

  // ── Reconcile ─────────────────────────────────────────────────────────────

  test('inventory reconcile page shows heading', async ({ page }) => {
    await page.goto('/inventory/reconcile');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
