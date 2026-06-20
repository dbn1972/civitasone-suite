import type { Page } from '@playwright/test';

export const COOKIE_NAME = 'civitasone_at';
export const TEST_TOKEN = 'e2e-test-token';

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
