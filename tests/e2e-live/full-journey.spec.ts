import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';
const GW = 'http://localhost:8080';

// Dev login credentials (from /auth/dev page)
const SUPERADMIN = { username: 'superadmin', password: 'Civitas@123' };
const OFFICER = { username: 'officer', password: 'Civitas@123' };

/**
 * Authenticates via the dev-login form and returns the cookie.
 */
async function devLogin(page: any, user: typeof SUPERADMIN) {
  await page.goto(`${BASE}/auth/dev`);
  await page.fill('#username', user.username);
  await page.fill('#password', user.password);
  await page.click('button[type="submit"]');
  // Should redirect to /dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

// ═══════════════════════════════════════════════════════════
// PHASE 1: AUTHENTICATION FLOW
// ═══════════════════════════════════════════════════════════

test.describe('Phase 1: Authentication', () => {
  test('dev login page renders correctly', async ({ page }) => {
    await page.goto(`${BASE}/auth/dev`);
    await expect(page.locator('h1')).toContainText('CivitasOne Suite');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('superadmin can log in and reaches dashboard', async ({ page }) => {
    await devLogin(page, SUPERADMIN);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('officer can log in and reaches dashboard', async ({ page }) => {
    await devLogin(page, OFFICER);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('invalid credentials show error', async ({ page }) => {
    await page.goto(`${BASE}/auth/dev`);
    await page.fill('#username', 'baduser');
    await page.fill('#password', 'wrongpass');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/error=1/);
  });

  test('unauthenticated access redirects to dev login', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(/\/auth\/dev/);
  });
});

// ═══════════════════════════════════════════════════════════
// PHASE 2: DASHBOARD & NAVIGATION
// ═══════════════════════════════════════════════════════════

test.describe('Phase 2: Dashboard & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, SUPERADMIN);
  });

  test('dashboard loads after login', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    // Should not be on login page
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('can navigate to finance module', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/finance/);
  });

  test('can navigate to hr module', async ({ page }) => {
    await page.goto(`${BASE}/hr`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/hr/);
  });

  test('can navigate to procurement module', async ({ page }) => {
    await page.goto(`${BASE}/procurement`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/procurement/);
  });

  test('can navigate to assets module', async ({ page }) => {
    await page.goto(`${BASE}/assets`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/assets/);
  });

  test('can navigate to projects module', async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/projects/);
  });

  test('can navigate to audit module', async ({ page }) => {
    await page.goto(`${BASE}/audit`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/audit/);
  });

  test('can navigate to helpdesk module', async ({ page }) => {
    await page.goto(`${BASE}/helpdesk`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/helpdesk/);
  });

  test('can navigate to crm module', async ({ page }) => {
    await page.goto(`${BASE}/crm`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/crm/);
  });

  test('can navigate to grants module', async ({ page }) => {
    await page.goto(`${BASE}/grants`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/grants/);
  });

  test('can navigate to legal module', async ({ page }) => {
    await page.goto(`${BASE}/legal`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/legal/);
  });

  test('can navigate to stock module', async ({ page }) => {
    await page.goto(`${BASE}/stock`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/stock/);
  });

  test('can navigate to estab module', async ({ page }) => {
    await page.goto(`${BASE}/estab`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/estab/);
  });

  test('can navigate to tenant-admin', async ({ page }) => {
    await page.goto(`${BASE}/tenant-admin`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/tenant-admin/);
  });
});

// ═══════════════════════════════════════════════════════════
// PHASE 3: GATEWAY API ENDPOINTS (direct service calls)
// ═══════════════════════════════════════════════════════════

test.describe('Phase 3: Gateway API — Live Services', () => {
  let token: string;

  test.beforeAll(async () => {
    // Mint an HS256 token matching the dev stack configuration
    const { createHmac } = await import('node:crypto');
    const SECRET = 'civitasone-dev-secret';
    const TENANT = '00000000-0000-0000-0000-000000000001';
    const now = Math.floor(Date.now() / 1000);
    const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64url({ alg: 'HS256', typ: 'JWT' });
    const payload = b64url({
      sub: '00000000-0000-0000-0000-000000000099',
      iss: 'civitasone-dev', tid: TENANT, tenantId: TENANT, sid: 'dev-session',
      email: 'superadmin@civitasone.dev', name: 'Super Admin',
      roles: ['super_admin','admin','tenant_admin','finance_admin','hr_admin','procurement_admin','asset_admin','project_admin'],
      iat: now, exp: now + 60 * 60 * 12,
    });
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
    token = `${header}.${payload}.${sig}`;
    expect(token).toBeTruthy();
  });

  test('gateway /health returns ok', async ({ request }) => {
    const r = await request.get(`${GW}/health`);
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.status).toBe('ok');
  });

  test('finance-service health via gateway', async ({ request }) => {
    const r = await request.get('http://localhost:3007/health');
    expect(r.ok()).toBeTruthy();
  });

  test('hrms-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3012/health');
    expect(r.ok()).toBeTruthy();
  });

  test('procurement-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3008/health');
    expect(r.ok()).toBeTruthy();
  });

  test('asset-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3015/health');
    expect(r.ok()).toBeTruthy();
  });

  test('project-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3014/health');
    expect(r.ok()).toBeTruthy();
  });

  test('identity-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3001/health');
    expect(r.ok()).toBeTruthy();
  });

  test('policy-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3003/health');
    expect(r.ok()).toBeTruthy();
  });

  test('audit-service health', async ({ request }) => {
    const r = await request.get('http://localhost:3004/health');
    expect(r.ok()).toBeTruthy();
  });

  test('GET /api/v1/finance/budgets via gateway with auth', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/finance/budgets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body) || body.data).toBeTruthy();
  });

  test('GET /api/v1/hrms/employees via gateway with auth', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/hrms/employees`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).toBeDefined();
  });

  test('GET /api/v1/procurement/vendors via gateway with auth', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/procurement/vendors`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status()).toBe(200);
  });

  test('GET /api/v1/asset/assets via gateway with auth', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/asset/assets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok()).toBeTruthy();
  });

  test('GET /api/v1/project/projects via gateway with auth', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/project/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok()).toBeTruthy();
  });

  test('401 when no token provided', async ({ request }) => {
    const r = await request.get(`${GW}/api/v1/finance/budgets`);
    expect(r.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════
// PHASE 4: FINANCE MODULE — Full User Journey
// ═══════════════════════════════════════════════════════════

test.describe('Phase 4: Finance Module Pages', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, SUPERADMIN);
  });

  test('finance landing page loads', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('finance dashboard page loads', async ({ page }) => {
    await page.goto(`${BASE}/finance/dashboard`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('chart of accounts page loads', async ({ page }) => {
    await page.goto(`${BASE}/finance/accounts`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('payments page loads', async ({ page }) => {
    await page.goto(`${BASE}/finance/payments`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('budgets page loads', async ({ page }) => {
    await page.goto(`${BASE}/finance/budgets`);
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/auth/);
  });
});

// ═══════════════════════════════════════════════════════════
// PHASE 5: CROSS-MODULE — Officer workflow
// ═══════════════════════════════════════════════════════════

test.describe('Phase 5: Officer Cross-Module Journey', () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, OFFICER);
  });

  test('officer reaches dashboard', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('officer can access finance', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('officer can access hr', async ({ page }) => {
    await page.goto(`${BASE}/hr`);
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('officer can access procurement', async ({ page }) => {
    await page.goto(`${BASE}/procurement`);
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test('officer can access crm', async ({ page }) => {
    await page.goto(`${BASE}/crm`);
    await expect(page).not.toHaveURL(/\/auth/);
  });
});

// ═══════════════════════════════════════════════════════════
// PHASE 6: LOGOUT FLOW
// ═══════════════════════════════════════════════════════════

test.describe('Phase 6: Logout', () => {
  test('logout page is accessible and processes', async ({ page }) => {
    await devLogin(page, SUPERADMIN);
    await page.goto(`${BASE}/logout`);
    await page.waitForLoadState('networkidle');
    // Logout page rendered successfully (may show a confirmation or redirect)
    const url = page.url();
    expect(url).toContain('localhost:3000');
  });
});
