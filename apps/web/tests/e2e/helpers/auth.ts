import { type Page, type BrowserContext } from '@playwright/test';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// HS256 JWT bypass — same pattern as service integration tests
const JWT_SECRET = 'test_secret_for_civitasone_32chr';
const JWT_ALGORITHM = 'HS256';

const COOKIE_NAME = 'civitasone_at';
const STORAGE_STATE_DIR = path.resolve(__dirname, '../.auth');

interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  tenantId: string;
  exp: number;
}

function base64url(data: string): string {
  return Buffer.from(data).toString('base64url');
}

/**
 * Create an HS256 JWT matching the CivitasOne auth bypass pattern.
 * This avoids hitting Keycloak for test purposes.
 */
function createTestJwt(payload: TokenPayload): string {
  const header = base64url(JSON.stringify({ alg: JWT_ALGORITHM, typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

const ADMIN_PAYLOAD: TokenPayload = {
  sub: 'admin-test-user',
  email: 'admin@civitasone.test',
  name: 'Test Admin',
  roles: [
    'super_admin',
    'tenant_admin',
    'finance_admin',
    'audit_admin',
    'audit_officer',
    'legal_admin',
    'legal_officer',
    'dept_head',
    'platform_admin',
  ],
  tenantId: 't0000000-0000-0000-0000-000000000001',
  exp: Math.floor(Date.now() / 1000) + 86400, // 24h
};

const MSME_PAYLOAD: TokenPayload = {
  sub: 'msme-test-user',
  email: 'msme@civitasone.test',
  name: 'MSME Vendor User',
  roles: ['msme_user', 'vendor'],
  tenantId: 't0000000-0000-0000-0000-000000000002',
  exp: Math.floor(Date.now() / 1000) + 86400,
};

/**
 * Returns an Authorization header with a valid HS256 JWT for admin.
 * Useful for direct API calls within tests.
 */
export function getAuthHeaders(role: 'admin' | 'msme' = 'admin'): Record<string, string> {
  const payload = role === 'admin' ? ADMIN_PAYLOAD : MSME_PAYLOAD;
  return { Authorization: `Bearer ${createTestJwt(payload)}` };
}

/**
 * Sets auth cookie on the browser context so the app layout
 * doesn't redirect to /auth/login. Stubs proxy API calls.
 */
async function setAuthCookie(context: BrowserContext, payload: TokenPayload): Promise<void> {
  const token = createTestJwt(payload);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Login as admin user. Sets up auth cookie and intercepts API proxy routes.
 * Uses storage state so subsequent tests in the same worker don't re-auth.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await setAuthCookie(page.context(), ADMIN_PAYLOAD);

  // Intercept client-side proxy calls (SyncProvider etc.)
  await page.route('**/api/proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/**
 * Login as an MSME/vendor user.
 */
export async function loginAsMsme(page: Page): Promise<void> {
  await setAuthCookie(page.context(), MSME_PAYLOAD);

  await page.route('**/api/proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/**
 * Navigate to a page with admin auth already established.
 */
export async function goAsAdmin(page: Page, path: string): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(path);
}

/**
 * Navigate to a page with MSME user auth.
 */
export async function goAsMsme(page: Page, path: string): Promise<void> {
  await loginAsMsme(page);
  await page.goto(path);
}

export { COOKIE_NAME, STORAGE_STATE_DIR, createTestJwt };
