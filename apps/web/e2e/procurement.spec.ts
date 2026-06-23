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

const LIVE = process.env.PROCUREMENT_E2E_LIVE === '1';

test.describe('Procurement', () => {
  test.beforeEach(async ({ page }) => {
    if (LIVE) {
      await authenticateLive(page);
    } else {
      await authenticate(page);
    }
  });

  test('vendor list shows column headers including GSTIN', async ({ page }) => {
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('heading', { name: /vendor/i }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GSTIN' })).toBeVisible();
  });

  test('vendor list shows seeded vendor when live', async ({ page }) => {
    test.skip(!LIVE, 'live stack only');
    await page.goto('/procurement/vendors');
    await expect(page.getByRole('link', { name: /Bharat Electronics/i })).toBeVisible();
  });

  test('vendor detail shows vendor name when live', async ({ page }) => {
    test.skip(!LIVE, 'live stack only');
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

  test('GRN detail shows three-way match when live', async ({ page }) => {
    test.skip(!LIVE, 'live stack only');
    await page.goto('/procurement/grn/11111111-0002-0000-0000-000000000005');
    await expect(page.getByText(/three-way match/i).first()).toBeVisible();
  });

  test('list pages show search toolbar', async ({ page }) => {
    await page.goto('/procurement/indents');
    await expect(page.getByRole('searchbox', { name: /search list/i })).toBeVisible();
  });

  test('procurement dashboard shows KPI cards', async ({ page }) => {
    await page.goto('/procurement/dashboard');
    await expect(page.getByText(/indent/i).or(page.getByText(/pending/i)).first()).toBeVisible();
  });
});
