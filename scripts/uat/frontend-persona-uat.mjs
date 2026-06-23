#!/usr/bin/env node
/**
 * CivitasOne Frontend Persona UAT — live web stack
 * Multi-viewport visual + functional checks by ERP persona.
 *
 * Usage:
 *   cd apps/web && node scripts/frontend-persona-uat.mjs [--base http://127.0.0.1:3000]
 *   (or: node scripts/frontend-quick-uat.cjs for faster matrix)
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (() => {
  const idx = process.argv.indexOf("--base");
  return idx >= 0 ? process.argv[idx + 1] : (process.env.WEB_URL ?? "http://127.0.0.1:3000");
})();

const OUT = process.env.UAT_OUT ?? "/tmp/civitasone-frontend-uat";
mkdirSync(OUT, { recursive: true });

/** ERP personas — role, responsibility, dev login */
const PERSONAS = {
  superadmin: {
    label: "Platform Super Admin",
    username: "superadmin",
    password: "Civitas@123",
    responsibility: "Tenant config, break-glass, all-module oversight",
    expectedModules: ["finance", "procurement", "hr", "audit", "tenant-admin"],
  },
  officer: {
    label: "Department Officer (Finance/HR/Procurement)",
    username: "officer",
    password: "Civitas@123",
    responsibility: "Budget, sanctions, indents, leave, payments processing",
    expectedModules: ["finance", "procurement", "hr"],
    deniedPaths: ["/tenant-admin/breakglass"],
  },
  auditor: {
    label: "Internal Auditor / Legal Officer",
    username: "auditor",
    password: "Civitas@123",
    responsibility: "Audit observations, legal cases, compliance read-only",
    expectedModules: ["audit", "legal"],
    deniedPaths: ["/finance/payments", "/tenant-admin/users"],
  },
};

const VIEWPORTS = {
  mobile: { width: 390, height: 844, label: "Mobile (iPhone 14)" },
  tablet: { width: 768, height: 1024, label: "Tablet (iPad)" },
  desktop: { width: 1280, height: 800, label: "Desktop (1280px)" },
};

/** Critical journeys per persona — path, journey name, checks */
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

async function devLogin(page, personaKey) {
  const p = PERSONAS[personaKey];
  await page.goto(`${BASE}/auth/dev`);
  await page.fill("#username", p.username);
  await page.fill("#password", p.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

async function assessPage(page, journey, viewportKey, personaKey) {
  const slug = journey.path.replace(/\//g, "_").replace(/^_/, "") || "root";
  const shot = join(OUT, `${personaKey}_${viewportKey}_${slug}.png`);

  const issues = [];
  let finalUrl = page.url();

  await page.goto(`${BASE}${journey.path}`, { waitUntil: "networkidle", timeout: 30000 });
  finalUrl = page.url();

  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const hasH1 = !!h1?.trim();
  const tableRows = await page.locator("table tbody tr").count();
  const kpiCards = await page.locator('[class*="StatCard"], [data-testid="kpi"], .kpi').count();
  const errorText = await page.locator('text=/not found|error|403|unauthorized|access denied/i').first().isVisible().catch(() => false);
  const navVisible = await page.locator('nav, aside, [role="navigation"]').first().isVisible().catch(() => false);
  const hasContent = tableRows > 0 || kpiCards > 0 || hasH1;

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

async function testRbacDenial(page, personaKey, deniedPath, viewportKey) {
  await page.setViewportSize(VIEWPORTS[viewportKey]);
  await page.goto(`${BASE}${deniedPath}`, { waitUntil: "networkidle", timeout: 20000 });
  const body = (await page.locator("body").innerText()).toLowerCase();
  const blocked =
    body.includes("403") ||
    body.includes("access denied") ||
    body.includes("not authorized") ||
    body.includes("forbidden") ||
    !page.url().includes(deniedPath.split("/").pop() ?? "") ||
    body.includes("not found");
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
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          /* captured in issues via visible errors */
        }
      });

      await devLogin(page, personaKey);

      for (const journey of JOURNEYS[personaKey] ?? []) {
        await page.setViewportSize(vp);
        const r = await assessPage(page, journey, vpKey, personaKey);
        results.push(r);
      }

      if (persona.deniedPaths?.length && vpKey === "desktop") {
        for (const dp of persona.deniedPaths) {
          rbacResults.push(await testRbacDenial(page, personaKey, dp, vpKey));
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
  console.log(`Total checks: ${summary.total} | PASS: ${summary.pass} | FAIL: ${summary.fail}`);
  console.log("\nBy persona:");
  for (const [k, v] of Object.entries(summary.byPersona)) {
    console.log(`  ${k}: ${v.pass}/${v.total} (${v.score}%)`);
  }
  console.log("\nBy viewport:");
  for (const [k, v] of Object.entries(summary.byViewport)) {
    console.log(`  ${k}: ${v.pass}/${v.total} (${v.score}%)`);
  }
  console.log("\nRBAC denial checks:");
  for (const r of rbacResults) {
    console.log(`  ${r.path}: ${r.blocked ? "BLOCKED ✓" : "ALLOWED ✗"} (${r.url})`);
  }
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`  [${r.persona}] [${r.viewport}] ${r.journey}: ${r.issues.join("; ")}`);
  }
  console.log(`\nReport: ${join(OUT, "report.json")}`);
  console.log(`Screenshots: ${OUT}/`);

  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
