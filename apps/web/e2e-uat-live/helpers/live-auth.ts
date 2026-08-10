import type { BrowserContext, Page } from "@playwright/test";

/**
 * Real Keycloak login for live UAT E2E runs against the deployed
 * https://civitasone.65-2-205-201.nip.io environment.
 *
 * Unlike the mocked-cookie helpers used by apps/web/e2e/**, this drives the
 * actual hosted Keycloak login form so the whole chain (Nginx -> Next.js ->
 * Keycloak OIDC -> gateway JWT edge -> backend services) is exercised for
 * real, using the demo users seeded in the `civitasone` realm.
 */

export const LIVE_BASE_URL =
  process.env.UAT_BASE_URL ?? "https://civitasone.65-2-205-201.nip.io";

// Nginx only proxies /auth/realms/* to Keycloak and routes everything else
// (including /api/*) to Next.js, which itself talks to the gateway via a
// server-side proxy keyed off the httpOnly session cookie — there is no
// public path for a bare `Authorization: Bearer` call straight to the
// gateway. Since these tests run on the same host as the deployment, direct
// API-only lookups (not full page loads) go straight to the gateway.
export const GATEWAY_URL = process.env.UAT_GATEWAY_URL ?? "http://localhost:8080";

export interface DemoUser {
  username: string;
  password: string;
  label: string;
}

// Password intentionally matches the seeded demo accounts documented for this
// environment. These are non-production, tenant-sandbox credentials only.
export const DEMO_PASSWORD = "CivitasOne#2026!";

export const PRIYA: DemoUser = {
  username: "priya",
  password: DEMO_PASSWORD,
  label: "Priya Sharma (hr_admin / hr_officer)",
};

// payroll-service enforces separation of duties: creating pay structures /
// runs requires payroll_admin, payroll_officer, or super_admin — hr_admin is
// intentionally NOT sufficient (verified directly against the API: priya
// gets 403 FORBIDDEN on POST /v1/payroll/structures). The payroll flow below
// therefore uses the seeded super_admin demo account instead of priya.
export const SUPER_ADMIN: DemoUser = {
  username: "admin@civitasone.dev",
  password: DEMO_PASSWORD,
  label: "Admin (super_admin)",
};

/**
 * Logs in through the real hosted Keycloak login page (not a mocked cookie).
 * Navigates to /auth/login, fills the Keycloak-rendered form, submits, and
 * waits for the app to land back on an authenticated page.
 */
export async function liveLogin(
  page: Page,
  user: DemoUser = PRIYA,
): Promise<void> {
  // /auth/login -> redirect("/api/auth/login") -> PKCE kickoff -> Keycloak
  // authorize endpoint, which serves the hosted login form directly (the
  // browser URL stays on /protocol/openid-connect/auth?...; the form's own
  // `action` attribute points at login-actions/authenticate, not the URL bar).
  await page.goto("/auth/login");
  await page.waitForURL(/\/auth\/realms\/civitasone\/protocol\/openid-connect\/auth/, {
    timeout: 30_000,
  });
  await page.locator("#username").waitFor({ state: "visible", timeout: 15_000 });

  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator("#kc-login").click();

  // After a successful login Keycloak redirects back to /api/auth/callback,
  // which exchanges the code and redirects into the app (typically /dashboard).
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/") && !url.pathname.startsWith("/api/auth/"), {
    timeout: 30_000,
  });
}

/**
 * Fetches an access token directly via the Resource Owner Password Credentials
 * grant against the live Keycloak instance. Useful for API-level assertions
 * that don't need a full browser login flow.
 */
// The nip.io host terminates TLS with a self-signed nginx cert (same as the
// browser context's ignoreHTTPSErrors). Node's global fetch doesn't have an
// equivalent per-call option, so the environment-level opt-out is required
// for these direct API calls made from the test/helper process itself.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export async function getLiveAccessToken(
  user: DemoUser = PRIYA,
): Promise<string> {
  const res = await fetch(
    `${LIVE_BASE_URL}/auth/realms/civitasone/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "civitasone-web",
        username: user.username,
        password: user.password,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `[live-auth] token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Returns true if the browser context currently holds an app session cookie. */
export async function hasSessionCookie(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies();
  return cookies.some((c) => c.name === "civitasone_at");
}
