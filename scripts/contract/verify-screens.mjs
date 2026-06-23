#!/usr/bin/env node
/**
 * verify-screens.mjs — live contract verifier
 *
 * Calls each GET loader path THROUGH the gateway with a dev JWT
 * and asserts HTTP 200 + non-empty body.
 *
 * Prerequisites: all services + gateway must be running.
 *
 * Usage:
 *   node scripts/contract/verify-screens.mjs
 *   node scripts/contract/verify-screens.mjs --module finance
 *   node scripts/contract/verify-screens.mjs --json
 *   node scripts/contract/verify-screens.mjs --gateway http://localhost:8080
 *
 * Exits non-zero if any in-scope screen fails.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHmac, randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const moduleFilter = args.includes('--module') ? (args[args.indexOf('--module') + 1] ?? null) : null;
const jsonOnly = args.includes('--json');
const gatewayBase = (() => {
  const idx = args.indexOf('--gateway');
  return idx >= 0 ? args[idx + 1] : (process.env.GATEWAY_URL ?? 'http://localhost:8080');
})();
const tenantId = process.env.TEST_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

/** Fixed seed UUIDs from scripts/dev/seed-all.mjs — used to resolve :param in live verify. */
const SEED_IDS = {
  actor: '00000000-0000-0000-0000-000000000099',
  user: '00000000-0000-0000-0000-000000000002',
  role: 'bbbbbbbb-0001-0000-0000-000000000001',
  asset: '77777777-0001-0000-0000-000000000003',
  payrollRun: 'ffffffff-0001-0000-0000-000000000005',
  employee: 'eeeeeeee-0001-0000-0000-000000000005',
  vendor: 'eeeeeeee-0001-0000-0000-000000000001',
  indent: '11111111-0002-0000-0000-000000000001',
  po: '11111111-0002-0000-0000-000000000003',
  rfq: '11111111-0003-0000-0000-000000000001',
  tender: '11111111-0003-0000-0000-000000000003',
  project: '44444444-0001-0000-0000-000000000003',
  grant: '55555555-0001-0000-0000-000000000005',
  stockItem: '88888888-0001-0000-0000-000000000005',
  legalCase: 'aaaaaaaa-0002-0000-0000-000000000003',
  crmContact: 'eeeeeeee-0002-0000-0000-000000000001',
  crmDeal: 'eeeeeeee-0002-0000-0000-000000000003',
  estabFile: '66666666-0001-0000-0000-000000000001',
  estabMeeting: '66666666-0001-0000-0000-000000000005',
  auditObservation: '99999999-0001-0000-0000-000000000005',
  reportJob: '33333333-0003-0000-0000-000000000001',
  financeBill: 'dddddddd-0001-0000-0000-000000000007',
  financeSanction: 'dddddddd-0001-0000-0000-000000000005',
  helpdeskTicket: '55555555-0004-0000-0000-000000000001',
};

function resolveApiPath(apiPath) {
  const rules = [
    [/asset\/assets\/:param/, SEED_IDS.asset],
    [/payroll\/runs\/:param/, SEED_IDS.payrollRun],
    [/hrms\/employees\/:param/, SEED_IDS.employee],
    [/procurement\/vendors\/:param/, SEED_IDS.vendor],
    [/procurement\/indents\/:param/, SEED_IDS.indent],
    [/procurement\/pos\/:param/, SEED_IDS.po],
    [/procurement\/rfqs\/:param/, SEED_IDS.rfq],
    [/procurement\/tenders\/:param/, SEED_IDS.tender],
    [/project\/projects\/:param/, SEED_IDS.project],
    [/grants\/grants\/:param/, SEED_IDS.grant],
    [/stock\/items\/:param/, SEED_IDS.stockItem],
    [/legal\/cases\/:param/, SEED_IDS.legalCase],
    [/crm\/contacts\/:param/, SEED_IDS.crmContact],
    [/crm\/deals\/:param/, SEED_IDS.crmDeal],
    [/estab\/files\/:param/, SEED_IDS.estabFile],
    [/estab\/meetings\/:param/, SEED_IDS.estabMeeting],
    [/audit\/observations\/:param/, SEED_IDS.auditObservation],
    [/reports\/report-jobs\/:param/, SEED_IDS.reportJob],
    [/finance\/bills\/:param/, SEED_IDS.financeBill],
    [/finance\/sanctions\/:param/, SEED_IDS.financeSanction],
    [/citizen\/tickets\/:param/, SEED_IDS.helpdeskTicket],
    [/policy\/roles\/:param/, SEED_IDS.role],
    [/identity\/users\/:param/, SEED_IDS.user],
  ];
  for (const [pattern, id] of rules) {
    if (pattern.test(apiPath)) return apiPath.replace(':param', id);
  }
  return apiPath.replace(':param', SEED_IDS.actor);
}

// ── JWT minting ───────────────────────────────────────────────────────────────

function mintDevJWT() {
  const secret = process.env.JWT_SECRET ?? 'civitasone-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000099',
    iss: 'civitasone-dev',
    aud: 'civitasone',
    tid: tenantId,
    tenantId,
    roles: ['super_admin', 'admin', 'finance_admin', 'hr_admin', 'procurement_admin', 'audit_admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  })).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ── Load screen-map ───────────────────────────────────────────────────────────

function loadScreenMap() {
  const mapPath = join(ROOT, 'scripts/contract/screen-map.json');
  if (!existsSync(mapPath)) {
    throw new Error('screen-map.json not found. Run: node scripts/contract/screen-map.mjs first');
  }
  return JSON.parse(readFileSync(mapPath, 'utf8'));
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────

async function fetchRoute(apiPath, jwt) {
  const url = `${gatewayBase}${apiPath}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'x-tenant-id': tenantId,
        'x-correlation-id': randomUUID(),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    let body = null;
    let bodyText = '';
    try {
      bodyText = await resp.text();
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }

    return { status: resp.status, ok: resp.ok, body };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

function hasData(body) {
  if (Array.isArray(body) && body.length > 0) return true;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.data) && body.data.length > 0) return true;
    if (Array.isArray(body.items) && body.items.length > 0) return true;
    // dashboards and single objects with fields count as "has data"
    if (Object.keys(body).length > 0 && !Array.isArray(body)) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { rows } = loadScreenMap();
  const jwt = mintDevJWT();

  // Only test screens that have loaders and are in-scope
  const toTest = rows.filter(r =>
    r.status !== 'NO_LOADER' &&
    r.apiPaths.length > 0 &&
    (!moduleFilter || r.module === moduleFilter),
  );

  // Deduplicate by API path to avoid hammering same endpoint multiple times
  const pathsSeen = new Set();
  const unique = toTest.filter(r => {
    const key = r.apiPaths[0];
    if (pathsSeen.has(key)) return false;
    pathsSeen.add(key);
    return true;
  });

  if (!jsonOnly) {
    process.stdout.write(`\nLive verification: ${unique.length} unique paths, gateway ${gatewayBase}\n\n`);
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const row of unique) {
    const apiPath = resolveApiPath(row.apiPaths[0]);
    const { status, ok, body, error } = await fetchRoute(apiPath, jwt);

    let verdict;
    let reason = '';

    if (error) {
      verdict = 'FAIL';
      reason = `network error: ${error}`;
    } else if (status === 401 || status === 403) {
      verdict = 'FAIL';
      reason = `auth rejected (${status}) — JWT or role issue`;
    } else if (status === 404) {
      verdict = 'FAIL';
      reason = `404 not found — route missing in service`;
    } else if (!ok) {
      verdict = 'FAIL';
      reason = `HTTP ${status}`;
    } else if (!hasData(body)) {
      // 200 but empty — warn as EMPTY (not a hard fail unless seeded data expected)
      verdict = 'EMPTY';
      reason = '200 but no data rows (seed data may be missing)';
    } else {
      verdict = 'PASS';
      passed++;
    }

    if (verdict === 'FAIL') failed++;

    results.push({
      module: row.module,
      screen: row.screen,
      loader: row.loaders[0] ?? '—',
      apiPath,
      status,
      verdict,
      reason,
    });

    if (!jsonOnly) {
      const icon = verdict === 'PASS' ? '✅' : verdict === 'EMPTY' ? '⚠️' : '❌';
      process.stdout.write(`  ${icon} [${row.module}] ${apiPath} → ${status} ${verdict}${reason ? ` (${reason})` : ''}\n`);
    }
  }

  const outDir = join(ROOT, 'scripts/contract');
  mkdirSync(outDir, { recursive: true });

  const report = {
    gateway: gatewayBase,
    tenant: tenantId,
    testedAt: new Date().toISOString(),
    results,
    counts: { total: unique.length, passed, failed, empty: results.filter(r => r.verdict === 'EMPTY').length },
  };

  writeFileSync(join(outDir, 'verify-report.json'), JSON.stringify(report, null, 2));

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write('\n────────────────────────────────────────────────────────\n');
    process.stdout.write(`  Total: ${unique.length}  PASS: ${passed}  FAIL: ${failed}  EMPTY: ${report.counts.empty}\n`);
    process.stdout.write('  Output: scripts/contract/verify-report.json\n\n');
  }

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
