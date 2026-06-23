#!/usr/bin/env node
/** Expanded visual UAT — ~84 journeys (28 routes × 3 viewports) */
const { chromium } = require("@playwright/test");
const { createHmac } = require("crypto");
const { mkdirSync, writeFileSync } = require("fs");

const BASE = process.env.UAT_BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.UAT_OUT ?? "/tmp/civitasone-expanded-uat";
mkdirSync(OUT, { recursive: true });

const VPS = {
  mobile: { w: 390, h: 844, label: "Mobile (390px)" },
  tablet: { w: 768, h: 1024, label: "Tablet (768px)" },
  desktop: { w: 1280, h: 800, label: "Desktop (1280px)" },
};

const ROLES = ["super_admin", "finance_admin", "hr_admin", "procurement_admin", "audit_admin", "asset_admin", "officer"];

/** 28 critical routes covering all major modules */
const JOURNEYS = [
  ["/dashboard", "Executive dashboard"],
  ["/finance/dashboard", "Finance dashboard"],
  ["/finance/expenditure/bills", "Vendor bills"],
  ["/finance/payments", "Payments"],
  ["/finance/accounting/vouchers/new", "New voucher"],
  ["/procurement/dashboard", "Procurement dashboard"],
  ["/procurement/indents", "Purchase indents"],
  ["/procurement/orders", "Purchase orders"],
  ["/procurement/vendors", "Vendors"],
  ["/procurement/tenders", "Tenders"],
  ["/procurement/grn", "GRN"],
  ["/hr/dashboard", "HR dashboard"],
  ["/hr/employees", "Employees"],
  ["/hr/leave", "Leave"],
  ["/hr/payroll", "Payroll runs"],
  ["/hr/payroll/salary-slips", "Salary slips"],
  ["/hr/appraisals", "APAR appraisals"],
  ["/hr/pay-matrix", "7th CPC pay matrix"],
  ["/hr/payroll/gpf", "GPF statements"],
  ["/hr/payroll/nps", "NPS statements"],
  ["/grants/list", "Grants"],
  ["/grants/installments", "Grant installments"],
  ["/projects/list", "Projects"],
  ["/stock/list", "Stock list"],
  ["/establishment/files", "Establishment files"],
  ["/citizen/requests", "Citizen requests"],
  ["/helpdesk/tickets", "Helpdesk tickets"],
  ["/audit/observations", "Audit observations"],
  ["/legal/list", "Legal cases"],
  ["/assets/dashboard", "Assets dashboard"],
  ["/reports/kpi", "KPI reports"],
];

function mint(sub) {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({
    sub, tid: "00000000-0000-0000-0000-000000000001", roles: ROLES,
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
  })).toString("base64url");
  const s = createHmac("sha256", "civitasone-dev-secret").update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const sub = "00000000-0000-0000-0000-000000000099";

  for (const [vk, vp] of Object.entries(VPS)) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await ctx.addCookies([{
      name: "civitasone_at", value: mint(sub),
      domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax",
    }]);

    for (const [path, name] of JOURNEYS) {
      process.stdout.write(".");
      let pass = false;
      let h1 = null;
      let issue = "";
      try {
        const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
          const err = await page.locator(".next-error-h1, .wrap >> text=/^500$|^403 Forbidden$/").first().isVisible().catch(() => false);
          await page.waitForTimeout(1500);
          h1 = (await page.locator("h1").first().textContent({ timeout: 8000 }).catch(() => null))?.trim() ?? null;
        if (!resp || resp.status() >= 400) issue = `HTTP ${resp?.status()}`;
        else if (page.url().includes("/auth/")) issue = "auth redirect";
        else if (err) issue = "error on page";
        else if (!h1) issue = "missing h1";
        else pass = true;
        await page.screenshot({ path: `${OUT}/${vk}${path.replace(/\//g, "_")}.png` }).catch(() => {});
      } catch (e) {
        issue = e.message?.slice(0, 80) ?? "timeout";
      }
      results.push({ id: `UAT-EXP-${String(results.length + 1).padStart(3, "0")}`, viewport: vp.label, journey: name, path, h1, pass, issue });
    }
    await ctx.close();
  }

  await browser.close();
  console.log("");

  const summary = {
    testedAt: new Date().toISOString(),
    base: BASE,
    total: results.length,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    target: 84,
    results,
  };
  writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));
  console.log(`\n=== Expanded Visual UAT: ${summary.pass}/${summary.total} PASS (target ~${summary.target}) ===`);
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`  FAIL [${r.viewport}] ${r.journey} (${r.path}): ${r.issue}`);
  }
  console.log(`Report: ${OUT}/report.json`);
  process.exit(summary.fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
