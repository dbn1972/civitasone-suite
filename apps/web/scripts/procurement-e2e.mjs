#!/usr/bin/env node
/**
 * Screen-wise headless E2E for procurement module against live web stack.
 * Usage: node scripts/procurement-e2e.mjs [--base http://127.0.0.1:3000]
 */
import { chromium } from '@playwright/test';
import { createHmac } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = (() => {
  const idx = process.argv.indexOf('--base');
  return idx >= 0 ? process.argv[idx + 1] : (process.env.WEB_URL ?? 'http://127.0.0.1:3000');
})();

const OUT = '/tmp/procurement-e2e';
mkdirSync(OUT, { recursive: true });

const SCREENS = [
  { path: '/procurement', name: 'Hub', type: 'hub' },
  { path: '/procurement/dashboard', name: 'Dashboard', type: 'list', expectKpi: true },
  { path: '/procurement/indents', name: 'Indents', type: 'list' },
  { path: '/procurement/indents/11111111-0002-0000-0000-000000000001', name: 'Indent detail', type: 'detail' },
  { path: '/procurement/vendors', name: 'Vendors', type: 'list' },
  { path: '/procurement/vendors/eeeeeeee-0001-0000-0000-000000000001', name: 'Vendor detail', type: 'detail' },
  { path: '/procurement/orders', name: 'Purchase orders', type: 'list' },
  { path: '/procurement/orders/11111111-0002-0000-0000-000000000003', name: 'PO detail', type: 'detail' },
  { path: '/procurement/rfq', name: 'RFQ', type: 'list' },
  { path: '/procurement/rfq/11111111-0003-0000-0000-000000000001', name: 'RFQ detail', type: 'detail' },
  { path: '/procurement/grn', name: 'GRN', type: 'list' },
  { path: '/procurement/orders/new', name: 'New PO', type: 'form' },
  { path: '/procurement/grn/new', name: 'New GRN', type: 'form' },
  { path: '/procurement/grn/11111111-0002-0000-0000-000000000005', name: 'GRN detail', type: 'detail' },
  { path: '/procurement/tenders', name: 'Tenders', type: 'list' },
  { path: '/procurement/tenders/11111111-0003-0000-0000-000000000003', name: 'Tender detail', type: 'detail' },
  { path: '/procurement/approvals', name: 'Approvals', type: 'list' },
  { path: '/procurement/contracts', name: 'Contracts', type: 'list' },
];

function mintDevJwt() {
  const secret = process.env.JWT_SECRET ?? 'civitasone-dev-secret';
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000099',
    iss: 'civitasone-dev',
    tid: tenantId,
    tenantId,
    roles: ['super_admin', 'admin', 'finance_admin', 'hr_admin', 'procurement_admin', 'audit_admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function login(page) {
  const host = new URL(BASE).hostname;
  await page.context().addCookies([{
    name: 'civitasone_at',
    value: mintDevJwt(),
    domain: host === '127.0.0.1' ? '127.0.0.1' : host,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);
}

async function evaluateScreen(page, screen) {
  const url = `${BASE}${screen.path}`;
  const slug = screen.path.replace(/\//g, '_').replace(/^_/, '') || 'hub';
  const result = {
    screen: screen.name,
    path: screen.path,
    url,
    httpOk: false,
    hasHeading: false,
    headingText: null,
    apiUnavailable: false,
    errorBadge: false,
    hasTable: false,
    hasEmptyState: false,
    hasKpi: false,
    hasDsPageHeader: false,
    rowCount: 0,
    consoleErrors: [],
    networkFailures: [],
    screenshot: `${OUT}/${slug}.png`,
    status: 'FAIL',
    notes: [],
  };

  const consoleErrors = [];
  const networkFailures = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  const onResponse = (resp) => {
    const u = resp.url();
    if (u.includes('/api/') && resp.status() >= 400) {
      networkFailures.push(`${resp.status()} ${u.slice(0, 120)}`);
    }
  };
  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.httpOk = resp ? resp.status() < 400 : false;
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);

    const bodyText = await page.locator('body').innerText();
    result.apiUnavailable = /api unavailable/i.test(bodyText);
    result.errorBadge = /\.err-badge|data-error|Something went wrong/i.test(await page.content());

    const h1 = page.locator('h1').first();
    result.hasHeading = await h1.isVisible().catch(() => false);
    if (result.hasHeading) {
      result.headingText = (await h1.innerText()).trim().slice(0, 80);
    }

    result.hasDsPageHeader = await page.locator('.ph, [class*="PageHeader"]').count() > 0;
    result.hasTable = await page.locator('table, .tbl, [role="table"]').count() > 0;
    result.hasEmptyState = /no (records|data|items|results|indents|vendors|pending approvals)|empty/i.test(bodyText);
    result.hasKpi = await page.locator('.stat, [class*="StatCard"]').count() > 0;

    if (result.hasTable) {
      result.rowCount = await page.locator('tbody tr, .tbl tbody tr, table tbody tr').count();
    }

    await page.screenshot({ path: result.screenshot, fullPage: true });

    const contentOk =
      result.hasTable ||
      result.hasEmptyState ||
      result.hasKpi ||
      screen.type === 'hub' ||
      screen.type === 'detail' ||
      screen.type === 'form';
    const noErrors = !result.apiUnavailable && !result.errorBadge;
    const genericDetailTitles = ['Indent Detail', 'Vendor Profile', 'Purchase Order', 'Tender Detail', 'RFQ Detail', 'Goods Receipt Note'];
    if (screen.type === 'detail' && result.headingText && genericDetailTitles.includes(result.headingText)) {
      result.notes.push('Detail shows not-found/generic title');
    } else if (result.httpOk && result.hasHeading && noErrors && contentOk) {
      result.status = 'PASS';
    } else {
      if (!result.httpOk) result.notes.push('HTTP not OK');
      if (!result.hasHeading) result.notes.push('Missing h1');
      if (result.apiUnavailable) result.notes.push('API unavailable banner');
      if (result.errorBadge) result.notes.push('Error badge visible');
      if (!contentOk) result.notes.push('No table/KPI/empty/detail content');
    }
  } catch (e) {
    result.notes.push(e.message);
    try {
      await page.screenshot({ path: result.screenshot, fullPage: true });
    } catch {}
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }

  result.consoleErrors = consoleErrors.slice(0, 5);
  result.networkFailures = networkFailures.slice(0, 5);
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  console.log(`\nProcurement E2E — ${BASE}\n`);
  await login(page);

  const results = [];
  for (const screen of SCREENS) {
    const r = await evaluateScreen(page, screen);
    results.push(r);
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`${icon} ${r.screen.padEnd(18)} ${r.path}`);
    console.log(`    h1: ${r.headingText ?? '—'} | rows: ${r.rowCount} | kpi: ${r.hasKpi}`);
    if (r.notes.length) console.log(`    → ${r.notes.join('; ')}`);
    if (r.networkFailures.length) console.log(`    → API: ${r.networkFailures.join('; ')}`);
    if (r.consoleErrors.length) console.log(`    → console: ${r.consoleErrors[0]}`);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const summary = { base: BASE, total: results.length, passed, failed: results.length - passed, results };
  writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));

  console.log(`\n${passed}/${results.length} PASS — report: ${OUT}/report.json\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
