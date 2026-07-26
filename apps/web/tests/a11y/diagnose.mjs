/**
 * Ad-hoc diagnostic: print full axe violation detail for one route.
 * Usage: node tests/a11y/diagnose.mjs /dashboard
 */
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";

const route = process.argv[2] ?? "/dashboard";
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b({ alg: "HS256", typ: "JWT" });
const p = b({
  sub: "00000000-0000-0000-0000-000000000099",
  iss: "civitasone-dev",
  tid: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000001",
  sid: "diag",
  email: "superadmin@demo.gov.in",
  name: "Super Admin",
  roles: ["super_admin", "admin", "tenant_admin", "platform_admin", "reader", "viewer", "officer"],
  iat: now,
  exp: now + 3600,
});
const sig = createHmac("sha256", process.env.JWT_SECRET ?? "civitasone-dev-secret")
  .update(`${h}.${p}`)
  .digest("base64url");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: "civitasone_at", value: `${h}.${p}.${sig}`, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
]);
const page = await ctx.newPage();
await page.goto(`http://localhost:3000${route}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("main", { timeout: 15000 }).catch(() => {});

const r = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  .analyze();

console.log(`\n=== ${route} — ${r.violations.length} violation type(s) ===`);
for (const v of r.violations) {
  console.log(`\n### ${v.id} [${v.impact}] — ${v.help}`);
  for (const n of v.nodes.slice(0, 8)) {
    console.log(`  target: ${n.target.join(" ")}`);
    console.log(`  html:   ${n.html.slice(0, 180)}`);
    for (const c of [...(n.any ?? []), ...(n.all ?? [])]) {
      if (c.message) console.log(`  why:    ${c.message.slice(0, 300)}`);
    }
  }
}
await browser.close();
