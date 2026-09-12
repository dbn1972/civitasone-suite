import { test, expect } from '@playwright/test';
import { authenticate, COOKIE_NAME } from './helpers/auth';

// Some of these redirects come from NextResponse.redirect(new URL(...)),
// which emits an absolute Location header, and some from Next's `redirect()`
// helper with a relative path, which does not -- compare pathnames only so
// the assertion doesn't care which form a given route happens to use.
function redirectPathname(location: string): string {
  return location.startsWith('/') ? location.split('?')[0] : new URL(location).pathname;
}

// REL-023: every test in this file was stale against the 2026-08-09
// "eliminate interstitial" login redesign (d06f4ead, src/app/auth/login/page.tsx):
// GET /auth/login with no ?error= now unconditionally redirect()s straight to
// /api/auth/login -> the Keycloak IdP, instead of rendering a "Sign in with
// Keycloak" interstitial. Any test that let a real browser navigation follow
// that redirect chain either hung/errored against an unreachable Keycloak (as
// PR #1189 found for the Accessibility gate) or, on a dev box with a reachable
// Keycloak, actually landed on the real IdP login page -- neither is something
// this suite can or should assert against. Fixed by checking the app's own
// first-hop redirect (Location header, via page.request with maxRedirects: 0)
// for anything that leaves our origin, and only using `page.goto` + DOM
// assertions for routes that render our own UI end-to-end.
test.describe('Authentication', () => {
  test('bare /auth/login redirects straight to the Keycloak OIDC flow (no interstitial)', async ({ page }) => {
    const response = await page.request.get('/auth/login', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(redirectPathname(response.headers()['location'])).toBe('/api/auth/login');
  });

  test('login error page shows CivitasOne branding and a retry link', async ({ page }) => {
    // LoginClient (the only UI /auth/login ever renders) only mounts when
    // ?error= is present -- see page.tsx.
    await page.goto('/auth/login?error=unknown');
    await expect(page.getByText('CivitasOne Suite')).toBeVisible();
    await expect(page.getByRole('link', { name: /try again/i })).toHaveAttribute('href', '/api/auth/login');
  });

  test('error query param shows the sign-in-unsuccessful message', async ({ page }) => {
    await page.goto('/auth/login?error=invalid_credentials');
    await expect(page.getByRole('heading', { name: 'Sign-in unsuccessful' })).toBeVisible();
    // invalid_credentials isn't one of LoginClient's two special-cased errors
    // (access_denied / session_expired), so it falls into the generic copy.
    await expect(page.getByText(/Authentication failed \(invalid_credentials\)/)).toBeVisible();
  });

  test('unauthenticated visit to /dashboard redirects toward /auth/login', async ({ page }) => {
    // middleware.ts's own first redirect hop, without following it onward
    // through /auth/login's further redirect to Keycloak.
    const response = await page.request.get('/dashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(redirectPathname(response.headers()['location'])).toBe('/auth/login');
  });

  test('authenticated visit to /dashboard stays on dashboard', async ({ page }) => {
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Dashboard renders PageHeader title="Command Center" as the page's h1;
    // RoleCommandCenter (dashboard tile nav replacement) adds its own
    // "<Module> Command Center" h2s per role, which also contain the
    // substring "Command Center" -- scope to the exact page heading.
    await expect(page.getByRole('heading', { name: 'Command Center', exact: true })).toBeVisible();
  });

  test('logout clears cookie and redirects toward the Keycloak end-session endpoint', async ({ page }) => {
    await authenticate(page);
    // /logout (src/app/logout/route.ts) deliberately proxies through Keycloak's
    // RP-initiated logout endpoint (post_logout_redirect_uri=/auth/login) so the
    // IdP session is actually terminated, not just this app's own cookie.
    const response = await page.request.get('/logout', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/protocol/openid-connect/logout');
    const cookies = await page.context().cookies();
    const atCookie = cookies.find((c) => c.name === COOKIE_NAME);
    expect(atCookie).toBeUndefined();
  });
});
