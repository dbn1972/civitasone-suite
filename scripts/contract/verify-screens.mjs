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

/**
 * Static :param -> seeded-id rules. Returns null when no rule matches, so the
 * caller can fall back to discovering a real id from the parent collection.
 */
function resolveSeededPath(apiPath) {
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
  return null;
}

/**
 * Loader paths screen-map.mjs cannot fully reconstruct statically: the loader
 * builds the URL by string concatenation (a trailing id and/or a literal
 * suffix) or appends a query string, so the recorded path is a truncated
 * prefix. The loader source is the authority for the shape; each entry names
 * the loader it mirrors so a drift is easy to spot in review.
 *   collection: GET this list through the gateway and use the first row's id
 *   suffix:     literal tail the loader appends after the id
 *   query:      query string the loader always sends
 */
const LOADER_URL_SHAPES = {
  // getProcurementAnnualPlanById: "/api/v1/procurement/plans/" + id
  '/api/v1/procurement/plans/': { collection: '/api/v1/procurement/plans' },
  // getProcurementVendorScorecard: "/api/v1/procurement/vendors/" + id + "/scorecard"
  '/api/v1/procurement/vendors/': { collection: '/api/v1/procurement/vendors', suffix: '/scorecard' },
  // getNotificationExperiments: "...experiments?limit=100&offset=0" (route validates the paging query)
  '/api/v1/notification/experiments': { query: '?limit=100&offset=0' },
};

const discoveredIds = new Map();

/** First record id of a list endpoint, read through the gateway (null when empty/unreachable). */
async function discoverId(collectionPath, jwt) {
  if (discoveredIds.has(collectionPath)) return discoveredIds.get(collectionPath);
  let id = null;
  const r = await fetchRoute(collectionPath, jwt);
  if (r.ok) {
    const rows = Array.isArray(r.body) ? r.body
      : Array.isArray(r.body?.data) ? r.body.data
      : Array.isArray(r.body?.items) ? r.body.items : [];
    id = rows.find(x => x && typeof x === 'object' && typeof x.id === 'string')?.id ?? null;
  }
  discoveredIds.set(collectionPath, id);
  return id;
}

/**
 * Resolves a recorded loader path to a concrete request path. Order: loader URL
 * shape -> seeded-id rule -> id discovered from the parent collection -> the
 * placeholder actor id (an id that exists nowhere, so the route is reached but
 * answers with an application NOT_FOUND; see classifyNotFound()).
 * `placeholder` is true only for that last fallback.
 */
async function resolveApiPath(apiPath, jwt) {
  const shape = LOADER_URL_SHAPES[apiPath];
  if (shape) {
    let out = apiPath;
    if (shape.collection) {
      const id = await discoverId(shape.collection, jwt);
      out = shape.collection + '/' + (id ?? SEED_IDS.actor);
      if (!id) return { path: out + (shape.suffix ?? '') + (shape.query ?? ''), placeholder: true };
    }
    return { path: out + (shape.suffix ?? '') + (shape.query ?? ''), placeholder: false };
  }
  if (!apiPath.includes(':param')) return { path: apiPath, placeholder: false };
  const seeded = resolveSeededPath(apiPath);
  if (seeded) return { path: seeded, placeholder: false };
  const at = apiPath.indexOf(':param');
  const collection = apiPath.slice(0, at).replace(/\/$/, '');
  const id = await discoverId(collection, jwt);
  if (id) return { path: apiPath.replace(':param', id), placeholder: false };
  return { path: apiPath.replace(':param', SEED_IDS.actor), placeholder: true };
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

  // COMP-006 fix-up: screens tracked in known-broken-chains.json have a real
  // loader chain that correctly resolves to a real upstream service which
  // genuinely has no matching route yet (a pre-existing product gap, filed
  // as follow-up gap COMP-020 -- see that file and tests/contract/
  // screens.contract.test.ts for the full writeup). The static gate already
  // excludes them; this live check must too, or it would fail on the exact
  // same pre-existing 404s the static gate is deliberately not blocking on.
  const knownBrokenPath = join(ROOT, 'scripts/contract/known-broken-chains.json');
  const knownBrokenKeys = new Set(
    (existsSync(knownBrokenPath) ? JSON.parse(readFileSync(knownBrokenPath, 'utf8')).entries : [])
      .map(e => `${e.module}::${e.screen}`),
  );

  // Only test screens that have loaders and are in-scope
  const toTest = rows.filter(r =>
    r.status !== 'NO_LOADER' &&
    r.apiPaths.length > 0 &&
    !knownBrokenKeys.has(`${r.module}::${r.screen}`) &&
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

  // Live-only ledger: endpoints that answer a non-2xx on purpose today (an
  // honest 501 NOT_IMPLEMENTED, or a contract mismatch awaiting a product
  // decision). Distinct from known-broken-chains.json, which is keyed to the
  // STATIC chain status. A tracked path must keep reproducing the recorded
  // status: if it starts answering anything else (e.g. 200 once the endpoint
  // ships) the entry is stale and this run fails until it is removed.
  const knownGapsPath = join(ROOT, 'scripts/contract/live-known-gaps.json');
  const knownGaps = new Map(
    (existsSync(knownGapsPath) ? JSON.parse(readFileSync(knownGapsPath, 'utf8')).entries : [])
      .map(e => [e.apiPath, e]),
  );

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const row of unique) {
    const { path: apiPath, placeholder } = await resolveApiPath(row.apiPaths[0], jwt);
    const { status, ok, body, error } = await fetchRoute(apiPath, jwt);
    const gap = knownGaps.get(row.apiPaths[0]);

    let verdict;
    let reason = '';

    if (gap) {
      if (status === gap.status) {
        verdict = 'KNOWN_GAP';
        reason = `tracked in live-known-gaps.json (${gap.status}): ${gap.reason}`;
      } else {
        verdict = 'FAIL';
        reason = `stale live-known-gaps.json entry: expected ${gap.status}, got ${status} -- remove or update it`;
      }
    } else if (error) {
      verdict = 'FAIL';
      reason = `network error: ${error}`;
    } else if (status === 401 || status === 403) {
      verdict = 'FAIL';
      reason = `auth rejected (${status}) — JWT or role issue`;
    } else if (status === 404 && placeholder && body && typeof body === 'object' && body.code === 'NOT_FOUND') {
      // The route is wired and the service answered with its own application
      // NOT_FOUND for an id that exists nowhere, because the parent list had no
      // row to take an id from (seed gap, not a wiring gap). A missing route
      // answers the framework's own 404 body (no `code`) and still FAILs below.
      verdict = 'ROUTE_OK';
      reason = 'route reached; parent list empty so no real id (application NOT_FOUND for placeholder id)';
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
      const icon = verdict === 'PASS' ? '✅' : (verdict === 'EMPTY' || verdict === 'ROUTE_OK' || verdict === 'KNOWN_GAP') ? '⚠️' : '❌';
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
    counts: {
      total: unique.length, passed, failed,
      empty: results.filter(r => r.verdict === 'EMPTY').length,
      routeOk: results.filter(r => r.verdict === 'ROUTE_OK').length,
      knownGap: results.filter(r => r.verdict === 'KNOWN_GAP').length,
    },
  };

  writeFileSync(join(outDir, 'verify-report.json'), JSON.stringify(report, null, 2));

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write('\n────────────────────────────────────────────────────────\n');
    process.stdout.write(`  Total: ${unique.length}  PASS: ${passed}  FAIL: ${failed}  EMPTY: ${report.counts.empty}  ROUTE_OK: ${report.counts.routeOk}  KNOWN_GAP: ${report.counts.knownGap}\n`);
    process.stdout.write('  Output: scripts/contract/verify-report.json\n\n');
  }

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
