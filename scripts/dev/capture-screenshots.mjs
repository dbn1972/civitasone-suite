#!/usr/bin/env node
/**
 * capture-screenshots.mjs — drive the REAL running app via Keycloak OIDC login
 * and capture desktop screenshots of every module, module-wise, for review.
 *
 * Output: docs/screenshots/<module>/<screen>.png  +  docs/screenshots/index.html
 *
 * Usage: node scripts/dev/capture-screenshots.mjs
 * Env:   BASE_URL (default http://localhost:3000)
 *        KC_USER  (default dev-superadmin)  KC_PASS (default Admin@1234)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const playwright = await import(join(ROOT, "node_modules/.pnpm/playwright@1.61.0/node_modules/playwright/index.js"));
const chromium = playwright.chromium ?? playwright.default.chromium;
const OUT = join(ROOT, "docs", "screenshots");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const KC_USER = process.env.KC_USER ?? "dev-superadmin";
const KC_PASS = process.env.KC_PASS ?? "Admin@1234";
const VIEWPORT = { width: 1440, height: 900 };

// Module → list of {label, path} screens to capture
const MODULES = {
  Dashboard: [{ label: "Command Centre", path: "/dashboard" }],
  Finance: [
    { label: "Dashboard", path: "/finance/dashboard" },
    { label: "Bills", path: "/finance/expenditure/bills" },
    { label: "Sanctions", path: "/finance/budget/sanctions" },
    { label: "Chart of Accounts", path: "/finance/chart-of-accounts" },
    { label: "General Ledger", path: "/finance/accounting/general-ledger" },
    { label: "Vendors", path: "/finance/vendors" },
  ],
  HR: [
    { label: "Dashboard", path: "/hr/dashboard" },
    { label: "Employees", path: "/hr/employees" },
    { label: "Leave", path: "/hr/leave" },
    { label: "Attendance", path: "/hr/attendance" },
    { label: "Payroll", path: "/hr/payroll" },
    { label: "Recruitment", path: "/hr/recruitment" },
  ],
  Procurement: [
    { label: "Dashboard", path: "/procurement/dashboard" },
    { label: "Indents", path: "/procurement/indents" },
    { label: "Purchase Orders", path: "/procurement/orders" },
    { label: "Vendors", path: "/procurement/vendors" },
    { label: "Tenders", path: "/procurement/tenders" },
  ],
  Projects: [
    { label: "Dashboard", path: "/projects/dashboard" },
    { label: "Projects", path: "/projects/list" },
    { label: "Milestones", path: "/projects/milestones" },
    { label: "Fund Releases", path: "/projects/fund-releases" },
    { label: "Utilization", path: "/projects/utilization" },
  ],
  Grants: [
    { label: "Dashboard", path: "/grants/dashboard" },
    { label: "Applications", path: "/grants/applications" },
    { label: "Grantees", path: "/grants/grantees" },
    { label: "Releases", path: "/grants/releases" },
  ],
  Assets: [
    { label: "Dashboard", path: "/assets/dashboard" },
    { label: "Fixed Assets", path: "/assets/fixed-assets" },
    { label: "Depreciation", path: "/assets/depreciation" },
  ],
  Citizen: [
    { label: "RTI", path: "/citizen/rti" },
    { label: "Grievances", path: "/citizen/grievances" },
    { label: "Requests", path: "/citizen/requests" },
  ],
  CRM: [
    { label: "Dashboard", path: "/crm/dashboard" },
    { label: "Contacts", path: "/crm/contacts" },
    { label: "Deals", path: "/crm/deals" },
  ],
  Helpdesk: [
    { label: "Tickets", path: "/helpdesk/tickets" },
    { label: "SLAs", path: "/helpdesk/slas" },
  ],
  Audit: [
    { label: "Dashboard", path: "/audit/dashboard" },
    { label: "Observations", path: "/audit/observations" },
    { label: "Risk Register", path: "/audit/risk-register" },
  ],
  Legal: [
    { label: "Dashboard", path: "/legal/dashboard" },
    { label: "Cases", path: "/legal/list" },
    { label: "Hearings", path: "/legal/hearings" },
  ],
  Establishment: [
    { label: "Dashboard", path: "/estab/dashboard" },
    { label: "Files (eOffice)", path: "/estab/list" },
    { label: "Meetings", path: "/estab/meetings" },
    { label: "Vehicles", path: "/estab/vehicles" },
  ],
  Knowledge: [
    { label: "Dashboard", path: "/knowledge/dashboard" },
    { label: "Repository", path: "/knowledge/repository" },
    { label: "Records", path: "/knowledge/records" },
  ],
  Workflow: [
    { label: "My Tasks", path: "/workflow/my-tasks" },
    { label: "Definitions", path: "/workflow/definitions" },
  ],
  Analytics: [
    { label: "Dashboards", path: "/analytics/dashboards" },
    { label: "Query Builder", path: "/analytics/queries" },
  ],
  Stock: [
    { label: "Dashboard", path: "/stock/dashboard" },
    { label: "Ledger", path: "/stock/ledger" },
  ],
  Inventory: [
    { label: "Items", path: "/inventory/items" },
    { label: "Low Stock", path: "/inventory/low-stock" },
  ],
  Billing: [
    { label: "Plans", path: "/billing/plans" },
    { label: "Subscriptions", path: "/billing/subscriptions" },
    { label: "Invoices", path: "/billing/invoices" },
  ],
  Notifications: [
    { label: "List", path: "/notifications/list" },
    { label: "Templates", path: "/notifications/templates" },
  ],
  TenantAdmin: [
    { label: "Overview", path: "/tenant-admin" },
    { label: "Users", path: "/tenant-admin/users" },
    { label: "Roles", path: "/tenant-admin/roles" },
    { label: "Security Center", path: "/tenant-admin/security" },
    { label: "Operations", path: "/tenant-admin/operations" },
  ],
  SuperAdmin: [
    { label: "SA Dashboard", path: "/admin/sa-dashboard" },
    { label: "Tenants", path: "/admin/tenants" },
    { label: "Feature Flags", path: "/admin/feature-flags" },
  ],
};

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function login(page) {
  console.log("[login] navigating to login page…");
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Click "Sign in with Keycloak"
  const kcLink = page.locator('a[href="/api/auth/login"]');
  if (await kcLink.count()) {
    await kcLink.first().click();
  } else {
    await page.goto(`${BASE}/api/auth/login`, { waitUntil: "domcontentloaded" });
  }
  // Wait for the Keycloak login form
  await page.waitForSelector('#username, input[name="username"]', { timeout: 30000 });
  console.log("[login] filling Keycloak credentials…");
  await page.fill('#username, input[name="username"]', KC_USER);
  await page.fill('#password, input[name="password"]', KC_PASS);
  await page.click('#kc-login, button[type="submit"], input[type="submit"]');
  // Wait to land back in the app
  await page.waitForURL((url) => !url.toString().includes("8180"), { timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  console.log(`[login] landed at ${page.url()}`);
}

async function capture(page, module, screen) {
  const dir = join(OUT, slug(module));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug(screen.label)}.png`);
  try {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200); // let data load + render
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  ✓ ${module}/${screen.label}`);
    return { ...screen, file: `${slug(module)}/${slug(screen.label)}.png`, ok: true };
  } catch (err) {
    console.log(`  ✗ ${module}/${screen.label}: ${err.message}`);
    return { ...screen, file: null, ok: false };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  let loggedIn = false;
  try {
    await login(page);
    loggedIn = true;
  } catch (err) {
    console.error(`[login] FAILED: ${err.message} — capturing public pages only`);
  }

  const results = {};
  for (const [module, screens] of Object.entries(MODULES)) {
    console.log(`[module] ${module}`);
    results[module] = [];
    for (const screen of screens) {
      results[module].push(await capture(page, module, screen));
    }
  }

  await browser.close();

  writeFileSync(join(OUT, "results.json"), JSON.stringify({ loggedIn, capturedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nDone. loggedIn=${loggedIn}. Results → docs/screenshots/results.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
