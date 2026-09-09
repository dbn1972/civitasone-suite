import { test, expect } from '@playwright/test';
import { createHmac } from 'crypto';
import { authenticate } from './helpers/auth';

const SECRET = process.env.JWT_SECRET ?? 'civitasone-dev-secret';
const TENANT = '00000000-0000-0000-0000-000000000001';

function mintDevJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000099',
    iss: 'civitasone-dev',
    tid: TENANT,
    tenantId: TENANT,
    roles: ['super_admin', 'admin', 'procurement_admin', 'procurement_officer'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function authenticateLive(page: import('@playwright/test').Page) {
  const base = process.env.WEB_URL ?? process.env.BASE_URL ?? 'http://127.0.0.1:3000';
  const host = new URL(base).hostname;
  await page.context().addCookies([{
    name: 'civitasone_at',
    value: mintDevJwt(),
    domain: host === '127.0.0.1' ? '127.0.0.1' : host,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);
}


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
    // rendered; see UX-013 in the gap report for the row-link-naming pattern
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
    // REL-010: two compounding issues, both now fixed. (1) The indents fixture
    // in e2e/global-setup.ts was `[]`; procurement/indents/page.tsx only
    // renders the filterable DataTable (and its toolbar) when rows.length > 0,
    // so this toolbar was never in the DOM at all — see the fixture comment.
    // (2) Even with rows present, DataTable's filter input (ds/DataTable.tsx)
    // is a plain `<input type="text">`, which the accessibility tree exposes
    // as role "textbox", not "searchbox" — that role requires
    // `type="search"`. Its accessible name is the page's own
    // `filterPlaceholder` prop, not a fixed "search list" string. Asserting
    // the real role/name here rather than the aspirational one; filed as
    // UX-012 in the gap report (DataTable's filter isn't marked up as a
    // semantic search field anywhere it's used, unlike the one genuine
    // `type="search"` input in hr/directory/DirectoryClient.tsx).
    await expect(page.getByRole('textbox', { name: /filter by indent/i })).toBeVisible();
  });

  test('procurement dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/procurement/dashboard');
    await expect(page.getByText(/indent/i).or(page.getByText(/pending/i)).first()).toBeVisible();
  });
});
