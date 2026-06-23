#!/usr/bin/env node
/** Quick persona × viewport frontend UAT (CommonJS for reliability) */
const { chromium } = require("@playwright/test");
const { createHmac } = require("crypto");
const { mkdirSync, writeFileSync } = require("fs");

const BASE = "http://127.0.0.1:3000";
const OUT = "/tmp/civitasone-frontend-uat";
mkdirSync(OUT, { recursive: true });

const VPS = {
  mobile: { w: 390, h: 844, label: "Mobile (390px)" },
  tablet: { w: 768, h: 1024, label: "Tablet (768px)" },
  desktop: { w: 1280, h: 800, label: "Desktop (1280px)" },
};

const PERSONAS = {
  superadmin: {
    label: "Platform Super Admin",
    responsibility: "Full ERP oversight, tenant admin, all modules",
    sub: "00000000-0000-0000-0000-000000000099",
    roles: ["super_admin", "finance_admin", "hr_admin", "procurement_admin", "audit_admin", "asset_admin"],
    journeys: [
      ["/dashboard", "Executive dashboard"],
      ["/finance/dashboard", "Finance dashboard"],
      ["/procurement/indents", "Procurement indents"],
      ["/hr/employees", "Employee master"],
      ["/audit/observations", "Audit observations"],
      ["/assets/77777777-0001-0000-0000-000000000003", "Asset detail"],
      ["/helpdesk/tickets", "Helpdesk tickets"],
    ],
  },
  officer: {
    label: "Department Officer",
    responsibility: "Finance, HR, procurement day-to-day operations",
    sub: "00000000-0000-0000-0000-000000000098",
    roles: ["officer", "finance_admin", "hr_admin", "procurement_admin"],
    journeys: [
      ["/finance/expenditure/bills", "Vendor bills"],
      ["/procurement/orders", "Purchase orders"],
      ["/hr/leave", "Leave management"],
      ["/hr/payroll", "Payroll runs"],
    ],
  },
  auditor: {
    label: "Internal Auditor",
    responsibility: "Audit, legal, compliance read paths",
    sub: "00000000-0000-0000-0000-000000000097",
    roles: ["audit_admin", "legal_admin"],
    journeys: [
      ["/audit", "Audit dashboard"],
      ["/legal/list", "Legal cases"],
      ["/reports/kpi", "KPI dashboard"],
    ],
  },
};

function mint(sub, roles) {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({
    sub, tid: "00000000-0000-0000-0000-000000000001", roles,
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
  })).toString("base64url");
  const s = createHmac("sha256", "civitasone-dev-secret").update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const [pk, persona] of Object.entries(PERSONAS)) {
    for (const [vk, vp] of Object.entries(VPS)) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await ctx.addCookies([{
        name: "civitasone_at", value: mint(persona.sub, persona.roles),
        domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax",
      }]);

      for (const [path, name] of persona.journeys) {
        process.stdout.write(`.`);
        let pass = false;
        let h1 = null;
        let rows = 0;
        let issue = "";
        try {
          const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
          h1 = (await page.locator("h1").first().textContent({ timeout: 10000 }).catch(() => null))?.trim() ?? null;
          rows = await page.locator("table tbody tr").count();
          const err = await page.locator("text=/not found|403|unauthorized/i").first().isVisible().catch(() => false);
          if (!resp || resp.status() >= 400) issue = `HTTP ${resp?.status()}`;
          else if (page.url().includes("/auth/")) issue = "auth redirect";
          else if (err) issue = "error on page";
          else if (!h1) issue = "missing h1";
          else pass = true;
          await page.screenshot({ path: `${OUT}/${pk}_${vk}${path.replace(/\//g, "_")}.png` });
        } catch (e) {
          issue = e.message?.slice(0, 80) ?? "timeout";
        }
        results.push({
          id: `UAT-FE-${String(results.length + 1).padStart(3, "0")}`,
          persona: persona.label,
          responsibility: persona.responsibility,
          viewport: vp.label,
          journey: name,
          path,
          h1,
          rows,
          pass,
          issue,
        });
      }
      await ctx.close();
    }
  }

  await browser.close();
  console.log("");

  const summary = {
    testedAt: new Date().toISOString(),
    base: BASE,
    total: results.length,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    byPersona: {},
    byViewport: {},
    results,
  };
  for (const pk of Object.keys(PERSONAS)) {
    const sub = results.filter((r) => r.persona === PERSONAS[pk].label);
    summary.byPersona[pk] = {
      pass: sub.filter((r) => r.pass).length,
      total: sub.length,
      pct: Math.round((sub.filter((r) => r.pass).length / sub.length) * 100),
    };
  }
  for (const vk of Object.keys(VPS)) {
    const sub = results.filter((r) => r.viewport === VPS[vk].label);
    summary.byViewport[vk] = {
      pass: sub.filter((r) => r.pass).length,
      total: sub.length,
      pct: Math.round((sub.filter((r) => r.pass).length / sub.length) * 100),
    };
  }

  writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));
  console.log(`\n=== Frontend Persona UAT: ${summary.pass}/${summary.total} PASS ===`);
  console.log("By persona:", JSON.stringify(summary.byPersona));
  console.log("By viewport:", JSON.stringify(summary.byViewport));
  console.log("Failures:");
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`  ${r.id} [${r.viewport}] ${r.persona} — ${r.journey}: ${r.issue}`);
  }
  console.log(`Screenshots + report: ${OUT}/`);
  process.exit(summary.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
