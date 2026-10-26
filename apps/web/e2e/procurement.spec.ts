import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Procurement', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('vendor list shows column headers including GSTIN', async ({ page }) => {
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('heading', { name: /vendor/i }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GSTIN' })).toBeVisible();
  });

  test('vendor list shows seeded vendor', async ({ page }) => {
    await page.goto('/procurement/vendors');
    // REL-010: this is not a link. DataTable (ds/DataTable.tsx) only makes the
    // FIRST column a clickable <a>, and gives it an aria-label built from that
    // column's own value ("Open <vendorCode>") -- here that's "Open
    // VEN-BEL-001", not the vendor name. "Name" is the table's second column,
    // rendered as plain cell text. Asserting on text (which is how the vendor
    // actually surfaces) rather than link role/name matches what's really
    // rendered; see UX-015 in the gap report for the row-link-naming pattern
    // this reveals across every rowHref/rowLinkKey DataTable.
    await expect(page.getByText(/Bharat Electronics/i)).toBeVisible();
  });

  test('vendor detail shows vendor name', async ({ page }) => {
    await page.goto('/procurement/vendors/eeeeeeee-0001-0000-0000-000000000001');
    await expect(page.getByRole('heading', { name: /Bharat Electronics/i })).toBeVisible();
  });

  test('indents list loads without server error', async ({ page }) => {
    await page.goto('/procurement/indents');
    await expect(page.getByRole('heading', { name: /indent/i }).first()).toBeVisible();
    await expect(page.locator('text=500')).toHaveCount(0);
  });

  test('purchase orders page loads without error', async ({ page }) => {
    await page.goto('/procurement/orders');
    await expect(page.getByRole('heading', { name: /orders/i }).first()).toBeVisible();
  });

  test('approvals page renders workflow panel', async ({ page }) => {
    await page.goto('/procurement/approvals');
    await expect(page.getByRole('heading', { name: /approval/i }).first()).toBeVisible();
    await expect(page.getByText('Workflow approval queue')).toBeVisible();
  });

  test('GRN page loads without error', async ({ page }) => {
    await page.goto('/procurement/grn');
    await expect(page.getByRole('heading', { name: /grn|goods receipt/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /\+ New GRN/i })).toBeVisible();
  });

  test('new PO form page loads', async ({ page }) => {
    await page.goto('/procurement/orders/new');
    await expect(page.getByRole('heading', { name: /new purchase order/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create po/i })).toBeVisible();
  });

  test('new GRN form page loads', async ({ page }) => {
    await page.goto('/procurement/grn/new');
    await expect(page.getByRole('heading', { name: /new goods receipt/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /record grn/i })).toBeVisible();
  });

  test('GRN detail shows three-way match', async ({ page }) => {
    await page.goto('/procurement/grn/11111111-0002-0000-0000-000000000005');
    await expect(page.getByText(/three-way match/i).first()).toBeVisible();
  });

  test('list pages show search toolbar', async ({ page }) => {
    await page.goto('/procurement/indents');
    // REL-010 found two compounding issues here. (1) The indents fixture in
    // e2e/global-setup.ts was `[]`; procurement/indents/page.tsx only renders
    // the filterable DataTable (and its toolbar) when rows.length > 0, so this
    // toolbar was never in the DOM at all — see the fixture comment. Fixed
    // there. (2) DataTable's filter input (ds/DataTable.tsx) was a plain
    // `<input type="text">` (role "textbox", not "searchbox"), filed as
    // UX-014. UX-014 is now fixed: the input is `type="search"` and its
    // accessible name is derived from the page's own `filterPlaceholder`
    // prop ("Filter by indent no, …" -> "Search indent no, …"), matching the
    // one genuine `type="search"` input already in the codebase
    // (hr/directory/DirectoryClient.tsx). Asserting the real role/name.
    await expect(page.getByRole('searchbox', { name: /search indent/i })).toBeVisible();
  });

  test('procurement dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/procurement/dashboard');
    await expect(page.getByText(/indent/i).or(page.getByText(/pending/i)).first()).toBeVisible();
  });
});
