/**
 * Lighthouse CI auth hook (Req 7.3, task 36).
 *
 * Lighthouse audits /estab/files/list and /inventory/list, both of which
 * require an authenticated session — the app redirects an unauthenticated
 * request to /auth/login, and Lighthouse would then measure the login
 * page's performance instead of the target screen.
 *
 * Mints the same HS256 `civitasone_at` cookie as
 * apps/web/tests/a11y/persona-auth.ts (superadmin persona), so this reuses
 * the exact auth mechanism already proven out for the accessibility gate
 * rather than inventing a second one. Lighthouse CI calls this script via
 * the `puppeteerScript` collect setting before each URL is audited.
 */
const { createHmac } = require("node:crypto");

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const COOKIE = "civitasone_at";

const ALL_ROLES = [
  "super_admin", "admin", "tenant_admin", "platform_admin",
  "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
  "legal_admin", "project_admin", "grant_admin", "asset_admin",
  "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
  "reader", "viewer", "officer",
];

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function mintToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: "00000000-0000-0000-0000-000000000099",
    iss: "civitasone-dev",
    tid: TENANT,
    tenantId: TENANT,
    sid: "lighthouse-gate",
    email: "superadmin@demo.gov.in",
    name: "Super Admin",
    roles: ALL_ROLES,
    iat: now,
    exp: now + 60 * 60,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

module.exports = async (browser, context) => {
  const page = await browser.newPage();
  const url = new URL(context.url);
  await page.setCookie({
    name: COOKIE,
    value: mintToken(),
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  });
  await page.close();
};
