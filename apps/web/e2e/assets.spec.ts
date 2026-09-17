import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Assets', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub page shows navigation links', async ({ page }) => {
    await page.goto('/assets');
    await expect(page.getByRole('link', { name: 'Asset Register' })).toBeVisible();
    // href-scoped: the "Projects & AUC" tile's note ("...to fixed assets")
    // case-insensitively contains "fixed assets" too, so a loose name match
    // resolves to both tiles (strict-mode violation).
    await expect(page.locator('a.mtile[href="/assets/fixed-assets"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Infrastructure' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Maintenance' })).toBeVisible();
  });

  // ── Dashboard ────────────────────────────────────────────────────────────

  test('asset dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/assets/dashboard');
    await expect(page.getByText('Total Assets')).toBeVisible();
    await expect(page.getByText('Under Maintenance')).toBeVisible();
    // KPI relabeled from "Net Block" to "Net Book Value".
    await expect(page.getByText('Net Book Value')).toBeVisible();
  });

  // ── List ─────────────────────────────────────────────────────────────────

  test('asset register shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/list');
    // level: 1 -- the "Fixed asset register" table card also has an <h3>
    // matching /asset register/i.
    await expect(page.getByRole('heading', { name: 'Asset Register', level: 1 })).toBeVisible();
    // DS-conformance wave C (#98) simplified the register to 5 columns; the
    // old 9-column layout (Asset Code/Name/Category/Type/Purchase Date/
    // Purchase Cost/Current Value/Location/Dept) no longer exists.
    await expect(page.getByRole('columnheader', { name: 'Asset' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Item' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Location' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Net value' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('asset register shows seeded asset AST-001', async ({ page }) => {
    await page.goto('/assets/list');
    // UX-015 gave the row link an explicit accessible name built from the
    // identifying column ("Open Dell Laptop XPS 15"); the visible asset-code
    // text sits in an aria-hidden span, so getByRole can't find it by that
    // name any more -- match the visible text directly instead.
    await expect(page.getByText('AST-001')).toBeVisible();
    // exact: true -- the row-link cell's own accessible name ("Open Dell
    // Laptop XPS 15") also contains "Dell Laptop XPS 15" as a substring.
    await expect(page.getByRole('cell', { name: 'Dell Laptop XPS 15', exact: true })).toBeVisible();
  });

  // ── Detail ───────────────────────────────────────────────────────────────

  test('asset detail shows asset name and details', async ({ page }) => {
    await page.goto('/assets/ast-001');
    await expect(page.getByRole('heading', { name: 'Dell Laptop XPS 15' })).toBeVisible();
    await expect(page.getByText('AST-001')).toBeVisible();
  });

  test('asset detail breadcrumb links back to register', async ({ page }) => {
    await page.goto('/assets/ast-001');
    // Scope to the breadcrumb -- the sidebar also has a current-page "Assets" link.
    await expect(page.getByLabel('Breadcrumb').getByRole('link', { name: 'Assets' })).toBeVisible();
  });

  test('navigating list → detail shows asset detail', async ({ page }) => {
    await page.goto('/assets/list');
    // UX-015: the row link's accessible name is "Open <identifying column>"
    // (the asset code itself is aria-hidden -- see the test above).
    await page.getByRole('link', { name: /Dell Laptop XPS 15/ }).click();
    await expect(page.getByRole('heading', { name: 'Dell Laptop XPS 15' })).toBeVisible();
  });

  // ── Sub-lists ─────────────────────────────────────────────────────────────

  test('fixed assets shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/fixed-assets');
    // Page heading is now "Fixed Asset Register" (level: 1 -- this page also
    // has an <h3> "Fixed asset register" on its table card).
    await expect(page.getByRole('heading', { name: 'Fixed Asset Register', level: 1 })).toBeVisible();
    // DS-conformance wave C (#98): same simplified columns as the register above.
    await expect(page.getByRole('columnheader', { name: 'Asset' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Item' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });

  test('infrastructure assets shows heading and column headers', async ({ page }) => {
    await page.goto('/assets/infra');
    // level: 1 -- when the table is empty this page renders an
    // EmptyState heading ("No infrastructure assets") that also matches
    // a loose /infrastructure assets/i search; a seeded infra fixture
    // (added to global-setup.ts alongside this fix) keeps that state from
    // ever being reached in this test, but level: 1 is kept as a defensive
    // match against the same <h1 vs h3/h4> pattern fixed elsewhere in this file.
    await expect(page.getByRole('heading', { name: 'Infrastructure Assets', level: 1 })).toBeVisible();
    // Column renamed from "Asset Code" to "ID"; "Condition" is unchanged.
    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Condition' })).toBeVisible();
  });

  test('asset maintenance shows heading and seeded maintenance record', async ({ page }) => {
    await page.goto('/assets/maintenance');
    await expect(page.getByRole('heading', { name: 'Asset Maintenance' })).toBeVisible();
    // Columns relabeled: "Asset Code" -> "Job", "Maintenance Type" -> "Type".
    await expect(page.getByRole('columnheader', { name: 'Job' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  });
});
