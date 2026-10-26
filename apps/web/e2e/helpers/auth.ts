import type { Page } from '@playwright/test';

export const COOKIE_NAME = 'civitasone_at';
// Fake JWT (unsigned, not verified server-side in roleGuard) encoding all roles
// needed by audit/legal/tenant-admin role-guarded layouts.
// Payload: {"sub":"test-user","roles":["super_admin","audit_admin","finance_admin",
//           "audit_officer","legal_admin","legal_officer","tenant_admin","dept_head","platform_admin"],"exp":9999999999}
export const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItZTJlIiwidGlkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwidGVuYW50SWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiIsImhyX2FkbWluIiwicGF5cm9sbF9hZG1pbiIsImhyX3N0YWZmIiwiYXVkaXRfYWRtaW4iLCJmaW5hbmNlX2FkbWluIiwidGVuYW50X2FkbWluIiwiZGVwdF9oZWFkIiwicGxhdGZvcm1fYWRtaW4iXSwiaXNzIjoiY2l2aXRhc29uZS1kZXYiLCJhdWQiOiJjaXZpdGFzb25lIiwiaWF0IjoxNzg2Njg4MTg2LCJleHAiOjQ5NDI0NDgxODZ9.EF12s-F82rozN5egjF5To8Sgt5nvfsMr8hIVebsUu7A'; // signed: iss=civitasone-dev aud=civitasone tid=...0001

/** Prefix of the `sub` claim that tells the mock gateway which per-viewer scenario to answer with. */
export const SCENARIO_SUB_PREFIX = 'e2e-scn:';

/**
 * TEST_TOKEN with its `sub` replaced by `e2e-scn:<scenario>`. The web app only decodes the payload
 * (never verifies the signature), so the roles and expiry are unchanged and the page behaves exactly
 * as for TEST_TOKEN; the mock gateway reads the `sub` to answer this viewer from SCENARIOS
 * (e2e/global-setup.ts) - e.g. 'empty' for empty collections, 'down' for failing upstreams.
 */
export function scenarioToken(scenario: string): string {
  const [header, payload, signature] = TEST_TOKEN.split('.');
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
  claims.sub = `${SCENARIO_SUB_PREFIX}${scenario}`;
  return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
}

/**
 * Set the auth cookie so the (app) layout doesn't redirect to /auth/login,
 * and stub client-side proxy calls (SyncProvider) to avoid console noise.
 */
export async function authenticate(page: Page, scenario?: string): Promise<void> {
  await page.context().addCookies([{
    name: COOKIE_NAME,
    value: scenario ? scenarioToken(scenario) : TEST_TOKEN,
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

export async function goAuthenticated(page: Page, path: string, scenario?: string): Promise<void> {
  await authenticate(page, scenario);
  await page.goto(path);
}
