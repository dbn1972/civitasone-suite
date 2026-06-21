import type { Page } from '@playwright/test';

export const COOKIE_NAME = 'civitasone_at';
// Fake JWT (unsigned, not verified server-side in roleGuard) encoding all roles
// needed by audit/legal/tenant-admin role-guarded layouts.
// Payload: {"sub":"test-user","roles":["super_admin","audit_admin","finance_admin",
//           "audit_officer","legal_admin","legal_officer","tenant_admin","dept_head","platform_admin"],"exp":9999999999}
export const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiIsImF1ZGl0X2FkbWluIiwiZmluYW5jZV9hZG1pbiIsImF1ZGl0X29mZmljZXIiLCJsZWdhbF9hZG1pbiIsImxlZ2FsX29mZmljZXIiLCJ0ZW5hbnRfYWRtaW4iLCJkZXB0X2hlYWQiLCJwbGF0Zm9ybV9hZG1pbiJdLCJleHAiOjk5OTk5OTk5OTl9.test';

/**
 * Set the auth cookie so the (app) layout doesn't redirect to /auth/login,
 * and stub client-side proxy calls (SyncProvider) to avoid console noise.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: COOKIE_NAME,
    value: TEST_TOKEN,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);
  // Stub client-side API proxy calls (SyncProvider, etc.) with a blanket 200
  await page.route('**/api/proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

export async function goAuthenticated(page: Page, path: string): Promise<void> {
  await authenticate(page);
  await page.goto(path);
}
