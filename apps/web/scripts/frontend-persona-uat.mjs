#!/usr/bin/env node
/**
 * CivitasOne Frontend Persona UAT — live web stack
 * Multi-viewport visual + functional checks by ERP persona.
 *
 * Usage: node scripts/frontend-persona-uat.mjs [--base http://127.0.0.1:3000]
 */
import { chromium, devices } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = "00000000-0000-0000-0000-000000000001";

const BASE = (() => {
  const idx = process.argv.indexOf("--base");
  return idx >= 0 ? process.argv[idx + 1] : (process.env.WEB_URL ?? "http://127.0.0.1:3000");
})();

const OUT = process.env.UAT_OUT ?? "/tmp/civitasone-frontend-uat";
mkdirSync(OUT, { recursive: true });

const DEV_USERS = {
  superadmin: {
    sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin",
    email: "superadmin@civitasone.dev",
    roles: [
      "super_admin", "admin", "tenant_admin", "platform_admin",
      "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
      "legal_admin", "project_admin", "grant_admin", "asset_admin",
      "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
      "reader", "viewer", "officer",
    ],
  },
  officer: {
    sub: "00000000-0000-0000-0000-000000000098",
    name: "Department Officer",
    email: "officer@civitasone.dev",
    roles: ["officer", "finance_admin", "hr_admin", "procurement_admin", "crm_admin", "reader", "viewer"],
  },
  auditor: {
    sub: "00000000-0000-0000-0000-000000000097",
    name: "Auditor / Legal",
    email: "auditor@civitasone.dev",
    roles: ["audit_admin", "legal_admin", "reader", "viewer"],
  },
};

const PERSONAS = {
  superadmin: {
    label: "Platform Super Admin",
    responsibility: "Tenant config, break-glass, all-module oversight",
    deniedPaths: [],
  },
  officer: {
    label: "Department Officer (Finance/HR/Procurement)",
    responsibility: "Budget, sanctions, indents, leave, payments processing",
    deniedPaths: ["/tenant-admin/breakglass"],
  },
  auditor: {
    label: "Internal Auditor / Legal Officer",
    responsibility: "Audit observations, legal cases, compliance read-only",
    deniedPaths: ["/finance/payments", "/tenant-admin/users"],
  },
};

const VIEWPORTS = {
  mobile: { width: 390, height: 844, label: "Mobile (iPhone 14)" },
  tablet: { width: 768, height: 1024, label: "Tablet (iPad)" },
  desktop: { width: 1280, height: 800, label: "Desktop (1280px)" },
};

const JOURNEYS = {
  superadmin: [
    { path: "/dashboard", name: "Executive dashboard", expectH1: true, expectNav: true },
    { path: "/finance/dashboard", name: "Finance dashboard", expectTableOrKpi: true },
    { path: "/finance/budget/sanctions", name: "Sanctions list", expectTableOrKpi: true },
    { path: "/procurement/dashboard", name: "Procurement dashboard", expectTableOrKpi: true },
    { path: "/procurement/approvals", name: "Procurement approvals", expectTableOrKpi: true },
    { path: "/hr/dashboard", name: "HR dashboard", expectTableOrKpi: true },
    { path: "/hr/employees", name: "Employee master", expectTableOrKpi: true },
    { path: "/assets/list", name: "Asset register", expectTableOrKpi: true },
    { path: "/assets/77777777-0001-0000-0000-000000000003", name: "Asset detail", expectH1: true },
    { path: "/audit/observations", name: "Audit observations", expectTableOrKpi: true },
    { path: "/tenant-admin/users", name: "Tenant user admin", expectTableOrKpi: true },
    { path: "/helpdesk/tickets", name: "Helpdesk tickets", expectTableOrKpi: true },
  ],
  officer: [
    { path: "/finance/dashboard", name: "Finance officer dashboard", expectTableOrKpi: true },
    { path: "/finance/expenditure/bills", name: "Vendor bills", expectTableOrKpi: true },
    { path: "/procurement/indents", name: "Create/view indents", expectTableOrKpi: true },
    { path: "/procurement/orders", name: "Purchase orders", expectTableOrKpi: true },
    { path: "/hr/leave", name: "Leave management", expectTableOrKpi: true },
    { path: "/hr/payroll", name: "Payroll runs", expectTableOrKpi: true },
    { path: "/stock/list", name: "Stock items", expectTableOrKpi: true },
  ],
  auditor: [
    { path: "/audit", name: "Audit dashboard", expectTableOrKpi: true },
    { path: "/audit/observations", name: "Observations register", expectTableOrKpi: true },
    { path: "/audit/compliance", name: "Compliance tracker", expectTableOrKpi: true },
    { path: "/legal/list", name: "Legal cases", expectTableOrKpi: true },
    { path: "/reports/kpi", name: "KPI / MIS", expectTableOrKpi: true },
  ],
};

function mintJwt(user) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: user.sub,
    iss: "civitasone-dev",
    tid: TENANT,
    tenantId: TENANT,
    sid: "dev-session",
    email: user.email,
    name: user.name,
    roles: user.roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 * 12,
  })).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function devLogin(page, personaKey) {
  const host = new URL(BASE).hostname;
  await page.context().addCookies([{
    name: "civitasone_at",
    value: mintJwt(DEV_USERS[personaKey]),
    domain: host === "127.0.0.1" ? "127.0.0.1" : host,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function assessPage(page, journey, viewportKey, personaKey) {
  const slug = journey.path.replace(/\//g, "_").replace(/^_/, "") || "root";
  const shot = join(OUT, `${personaKey}_${viewportKey}_${slug}.png`);
  const issues = [];

  await page.goto(`${BASE}${journey.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  const finalUrl = page.url();

  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const hasH1 = !!h1?.trim();
  const tableRows = await page.locator("table tbody tr").count();
  const kpiCards = await page.locator('[class*="StatCard"], [data-testid="kpi"]').count();
  const listItems = await page.locator("main li, main [role='row']").count();
  const errorText = await page.locator('text=/not found|403|unauthorized|access denied/i').first().isVisible().catch(() => false);
  const navVisible = await page.locator('nav, aside, [role="navigation"]').first().isVisible().catch(() => false);
  const hasContent = tableRows > 0 || kpiCards > 0 || listItems > 2 || hasH1;

  if (journey.expectH1 && !hasH1) issues.push("Missing page heading (h1)");
  if (journey.expectTableOrKpi && !hasContent) issues.push("No table rows, KPI, or heading visible");
  if (journey.expectNav && !navVisible) issues.push("Navigation not visible");
  if (errorText) issues.push("Error/unauthorized message on page");
  if (finalUrl.includes("/auth/")) issues.push(`Redirected to auth: ${finalUrl}`);

  await page.screenshot({ path: shot, fullPage: false });

  return {
    journey: journey.name,
    path: journey.path,
    viewport: VIEWPORTS[viewportKey].label,
    persona: PERSONAS[personaKey].label,
    finalUrl,
    h1: h1?.trim() ?? null,
    tableRows,
    kpiCards,
    screenshot: shot,
    pass: issues.length === 0,
    issues,
  };
}

async function testRbacDenial(page, deniedPath) {
  await page.goto(`${BASE}${deniedPath}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  const body = (await page.locator("body").innerText()).toLowerCase();
  const blocked =
    body.includes("403") ||
    body.includes("access denied") ||
    body.includes("not authorized") ||
    body.includes("forbidden");
  return { path: deniedPath, blocked, url: page.url() };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const rbacResults = [];

  for (const [personaKey, persona] of Object.entries(PERSONAS)) {
    for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ ...devices["Desktop Chrome"], viewport: vp });
      const page = await context.newPage();
      await devLogin(page, personaKey);

      for (const journey of JOURNEYS[personaKey] ?? []) {
        results.push(await assessPage(page, journey, vpKey, personaKey));
      }

      if (persona.deniedPaths?.length && vpKey === "desktop") {
        for (const dp of persona.deniedPaths) {
          rbacResults.push(await testRbacDenial(page, dp));
        }
      }

      await context.close();
    }
  }

  await browser.close();

  const summary = {
    testedAt: new Date().toISOString(),
    baseUrl: BASE,
    total: results.length,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    byPersona: {},
    byViewport: {},
    rbac: rbacResults,
    results,
  };

  for (const key of Object.keys(PERSONAS)) {
    const subset = results.filter((r) => r.persona === PERSONAS[key].label);
    summary.byPersona[key] = {
      pass: subset.filter((r) => r.pass).length,
      total: subset.length,
      score: subset.length ? Math.round((subset.filter((r) => r.pass).length / subset.length) * 100) : 0,
    };
  }
  for (const key of Object.keys(VIEWPORTS)) {
    const subset = results.filter((r) => r.viewport === VIEWPORTS[key].label);
    summary.byViewport[key] = {
      pass: subset.filter((r) => r.pass).length,
      total: subset.length,
      score: subset.length ? Math.round((subset.filter((r) => r.pass).length / subset.length) * 100) : 0,
    };
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== CivitasOne Frontend Persona UAT ===");
  console.log(`Base: ${BASE}`);
  console.log(`Total: ${summary.total} | PASS: ${summary.pass} | FAIL: ${summary.fail}`);
  for (const [k, v] of Object.entries(summary.byPersona)) {
    console.log(`  ${k}: ${v.pass}/${v.total} (${v.score}%)`);
  }
  for (const [k, v] of Object.entries(summary.byViewport)) {
    console.log(`  viewport ${k}: ${v.pass}/${v.total} (${v.score}%)`);
  }
  console.log("RBAC:");
  for (const r of rbacResults) console.log(`  ${r.path}: ${r.blocked ? "BLOCKED" : "ALLOWED"}`);
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`  FAIL [${r.persona}] [${r.viewport}] ${r.journey}: ${r.issues.join("; ")}`);
  }
  console.log(`Report: ${join(OUT, "report.json")}`);

  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
