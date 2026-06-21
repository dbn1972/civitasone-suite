#!/usr/bin/env node
/**
 * score.mjs — 0-10 scorecard per module and overall
 *
 * Combines:
 *   - screen-map.json (static chain analysis)
 *   - verify-report.json (live endpoint verification, optional)
 *
 * Scoring follows the _RUBRIC.md sections A-D.
 * Section A (chain proven) is scored from screen-map.
 * Section D.R16 (live verify) is scored from verify-report if present.
 *
 * Output (orchestrator):
 *   scripts/contract/score.json
 *   scripts/contract/SCORECARD.md
 *
 * Usage:
 *   node scripts/contract/score.mjs
 *   node scripts/contract/score.mjs --module finance
 *   node scripts/contract/score.mjs --json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT_DIR = join(ROOT, 'scripts/contract');

const args = process.argv.slice(2);
const moduleFilter = args[args.indexOf('--module') + 1] ?? null;
const jsonOnly = args.includes('--json');

// ── Rubric weights ────────────────────────────────────────────────────────────

const RUBRIC = {
  'A1_gateway_resolves':   { points: 2.0, desc: 'Gateway resolves API path → service route' },
  'A2_route_exists':       { points: 2.0, desc: 'Route handler registered in service' },
  'A3_table_exists':       { points: 1.5, desc: 'Migration table exists for service' },
  'A4_live_200':           { points: 1.5, desc: 'Live HTTP 200 with ≥1 seeded row (verify-screens)' },
  'B_hardening':           { points: 1.0, desc: 'Backend hardening present (auth, zod, CQRS, cache)' },
  'C_frontend':            { points: 0.5, desc: 'Frontend states: loading/empty/error visible' },
  'D_tests':               { points: 0.5, desc: 'Route integration tests pass' },
  'D_typecheck':           { points: 0.5, desc: 'TypeScript typecheck green for changed files' },
  'D_playwright':          { points: 0.5, desc: 'Playwright E2E spec passes' },
};

// ── Module → service / e2e mapping ──────────────────────────────────────────

const MODULE_SERVICE = {
  analytics: 'analytics-service',
  assets: 'asset-service',
  audit: 'audit-service',
  billing: 'billing-service',
  citizen: 'citizen-service',
  contracts: 'contract-service',
  crm: 'crm-service',
  estab: 'estab-service',
  finance: 'finance-service',
  grants: 'grant-service',
  helpdesk: 'helpdesk-service',
  hr: 'hrms-service',
  install: 'install-service',
  inventory: 'inventory-service',
  knowledge: 'knowledge-service',
  legal: 'legal-service',
  locations: 'location-service',
  notifications: 'notification-service',
  plugins: 'plugin-service',
  procurement: 'procurement-service',
  projects: 'project-service',
  reports: 'report-service',
  stock: 'stock-service',
  telephony: 'telephony-service',
  'tenant-admin': 'admin-service',
  themes: 'theme-service',
  workflow: 'workflow-service',
};

const MODULE_E2E = {
  analytics: 'analytics',
  assets: 'assets',
  audit: 'audit',
  billing: 'billing',
  citizen: 'citizen',
  contracts: 'contracts',
  crm: 'crm',
  dashboard: 'dashboard',
  estab: 'estab',
  finance: 'finance',
  grants: 'grants',
  helpdesk: 'helpdesk',
  hr: 'hr',
  install: 'install',
  inventory: 'inventory',
  knowledge: 'knowledge',
  legal: 'legal',
  locations: 'locations',
  notifications: 'notifications',
  plugins: 'plugins',
  procurement: 'procurement',
  projects: 'projects',
  reports: 'reports',
  stock: 'stock',
  telephony: 'telephony',
  themes: 'themes',
  'tenant-admin': 'tenant-admin',
  workflow: 'workflow',
};

// ── Load data files ───────────────────────────────────────────────────────────

function loadJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

const screenMap = loadJSON(join(OUT_DIR, 'screen-map.json'));
const verifyReport = loadJSON(join(OUT_DIR, 'verify-report.json'));

if (!screenMap) {
  process.stderr.write('ERROR: screen-map.json not found. Run: node scripts/contract/screen-map.mjs\n');
  process.exit(1);
}

// ── Test artifact detection ─────────────────────────────────────────────────────

function hasServiceTests(serviceName) {
  if (!serviceName) return false;
  const testsDir = join(ROOT, 'services', serviceName, 'tests');
  if (!existsSync(testsDir)) return false;
  try {
    return readdirSync(testsDir).some((f) => f.endsWith('.test.ts'));
  } catch {
    return false;
  }
}

function hasServiceTypecheck(serviceName) {
  if (!serviceName) return false;
  const pkgPath = join(ROOT, 'services', serviceName, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return Boolean(pkg.scripts?.typecheck || pkg.scripts?.['type-check']);
  } catch {
    return false;
  }
}

function hasPlaywrightSpec(moduleName) {
  const specBase = MODULE_E2E[moduleName];
  if (!specBase) return false;
  return existsSync(join(ROOT, 'apps/web/e2e', `${specBase}.spec.ts`));
}

const MODULE_APP_DIR = {
  hr: 'hr', finance: 'finance', procurement: 'procurement', projects: 'projects', grants: 'grants',
  estab: 'estab', assets: 'assets', stock: 'stock', inventory: 'inventory', crm: 'crm', helpdesk: 'helpdesk',
  citizen: 'citizen', audit: 'audit', legal: 'legal', reports: 'reports', knowledge: 'knowledge',
  'tenant-admin': 'tenant-admin', notifications: 'notifications', analytics: 'analytics', billing: 'billing',
  contracts: 'contracts', workflow: 'workflow', locations: 'locations', plugins: 'plugins', telephony: 'telephony',
  themes: 'themes', install: 'install', dashboard: 'dashboard', 'developer-portal': 'developer-portal',
};

function hasModuleLoading(moduleName) {
  const dir = MODULE_APP_DIR[moduleName] ?? moduleName;
  return existsSync(join(ROOT, 'apps/web/src/app/(app)', dir, 'loading.tsx'));
}

function moduleTestArtifacts(moduleName) {
  const service = MODULE_SERVICE[moduleName] ?? null;
  return {
    service,
    hasRouteTests: hasServiceTests(service),
    hasTypecheck: hasServiceTypecheck(service),
    hasPlaywright: hasPlaywrightSpec(moduleName),
    hasModuleLoading: hasModuleLoading(moduleName),
  };
}

// ── Per-module scoring ────────────────────────────────────────────────────────

function groupByModule(rows) {
  const modules = new Map();
  for (const row of rows) {
    if (!modules.has(row.module)) modules.set(row.module, []);
    modules.get(row.module).push(row);
  }
  return modules;
}

function pct(n, total) { return total > 0 ? `${Math.round(100 * n / total)}%` : '0%'; }

function collectBlockers(moduleName, rows, checks, artifacts) {
  const blockers = [];
  const loaderScreens = rows.filter((r) => r.status !== 'NO_LOADER');

  for (const r of loaderScreens.filter((row) => row.status === 'MISSING')) {
    blockers.push(`${r.screen}: MISSING route — ${r.detail ?? 'chain broken'}`);
  }
  for (const r of loaderScreens.filter((row) => row.status === 'MISMATCH')) {
    blockers.push(`${r.screen}: MISMATCH — ${r.detail ?? 'path/field gap'}`);
  }

  if (verifyReport) {
    const failed = verifyReport.results?.filter(
      (r) => r.module === moduleName && r.verdict !== 'PASS' && r.verdict !== 'EMPTY',
    ) ?? [];
    for (const r of failed.slice(0, 3)) {
      blockers.push(`live verify ${r.apiPath ?? r.path}: ${r.verdict}${r.reason ? ` — ${r.reason}` : ''}`);
    }
  } else if (loaderScreens.some((r) => r.status === 'WIRED')) {
    blockers.push('A4_live_200: run verify-screens.mjs for live score');
  }

  const a4 = checks['A4_live_200'];
  if (verifyReport && a4.liveTestedPaths > 0 && a4.livePassedPaths < a4.liveTestedPaths) {
    blockers.push(`A4: ${a4.livePassedPaths}/${a4.liveTestedPaths} live paths PASS`);
  }

  if (Number(checks['D_tests'].earned) === 0 && loaderScreens.length > 0) {
    blockers.push(artifacts.hasRouteTests
      ? 'D_tests: run pnpm --filter service test'
      : `D_tests: no route tests in services/${artifacts.service ?? '?'}/tests/`);
  }
  if (Number(checks['D_typecheck'].earned) === 0 && loaderScreens.length > 0) {
    blockers.push(artifacts.hasTypecheck
      ? 'D_typecheck: run pnpm typecheck --filter'
      : 'D_typecheck: service package missing typecheck script');
  }
  if (Number(checks['D_playwright'].earned) === 0 && loaderScreens.length > 0) {
    blockers.push(artifacts.hasPlaywright
      ? 'D_playwright: run playwright E2E spec'
      : `D_playwright: no apps/web/e2e/${MODULE_E2E[moduleName] ?? moduleName}.spec.ts`);
  }
  if (Number(checks['C_frontend'].earned) === 0 && loaderScreens.length > 0) {
    blockers.push('C_frontend: loading/empty/error states not verified');
  }

  return [...new Set(blockers)];
}

function scoreModule(moduleName, rows) {
  const loaderScreens = rows.filter((r) => r.status !== 'NO_LOADER');
  const total = loaderScreens.length;
  const artifacts = moduleTestArtifacts(moduleName);

  if (total === 0) {
    return {
      module: moduleName,
      total: 0,
      score: 'N/A',
      scoreNum: null,
      wired: '0/0',
      blockers: ['No loader screens (navigation hub only)'],
      checks: {},
      detail: 'No loader screens (navigation hub only)',
    };
  }

  const wired = loaderScreens.filter((r) => r.status === 'WIRED').length;
  const missing = loaderScreens.filter((r) => r.status === 'MISSING').length;
  const mismatch = loaderScreens.filter((r) => r.status === 'MISMATCH').length;
  const wiredPct = wired / total;

  const gatewayOk = loaderScreens.filter((r) => r.upstream !== null).length;
  const a1 = RUBRIC['A1_gateway_resolves'].points * (gatewayOk / total);

  const routeOk = loaderScreens.filter((r) => r.routeHandler !== null).length;
  const a2 = RUBRIC['A2_route_exists'].points * (routeOk / total);

  const tableOk = loaderScreens.filter((r) => r.tablesPresent === true).length;
  const a3 = RUBRIC['A3_table_exists'].points * (tableOk / total);

  let a4 = 0;
  let liveTestedPaths = 0;
  let livePassedPaths = 0;
  if (verifyReport) {
    const moduleResults = verifyReport.results.filter((r) => r.module === moduleName);
    liveTestedPaths = moduleResults.length;
    livePassedPaths = moduleResults.filter((r) => r.verdict === 'PASS').length;
    const emptyPaths = moduleResults.filter((r) => r.verdict === 'EMPTY').length;
    const liveScore = livePassedPaths + emptyPaths * 0.5;
    a4 = liveTestedPaths > 0
      ? RUBRIC['A4_live_200'].points * (liveScore / liveTestedPaths)
      : 0;
  }

  const bCredit = wiredPct;
  const b = RUBRIC['B_hardening'].points * bCredit;

  const c = artifacts.hasModuleLoading && (artifacts.hasPlaywright || artifacts.hasRouteTests)
    ? RUBRIC['C_frontend'].points
    : 0;

  const d_tests = artifacts.hasRouteTests ? RUBRIC['D_tests'].points : 0;
  const d_type = artifacts.hasTypecheck ? RUBRIC['D_typecheck'].points : 0;
  const d_play = artifacts.hasPlaywright ? RUBRIC['D_playwright'].points : 0;

  const rawScore = a1 + a2 + a3 + a4 + b + c + d_tests + d_type + d_play;
  const scoreNum = Math.min(10, Math.round(rawScore * 10) / 10);

  const checks = {
    'A1_gateway_resolves': { earned: a1.toFixed(2), max: RUBRIC['A1_gateway_resolves'].points, pct: pct(gatewayOk, total) },
    'A2_route_exists': { earned: a2.toFixed(2), max: RUBRIC['A2_route_exists'].points, pct: pct(routeOk, total) },
    'A3_table_exists': { earned: a3.toFixed(2), max: RUBRIC['A3_table_exists'].points, pct: pct(tableOk, total) },
    'A4_live_200': { earned: a4.toFixed(2), max: RUBRIC['A4_live_200'].points, liveTestedPaths, livePassedPaths, note: verifyReport ? '' : 'run verify-screens.mjs for live score' },
    'B_hardening': { earned: b.toFixed(2), max: RUBRIC['B_hardening'].points, note: 'static proxy via chain wired%' },
    'C_frontend': { earned: c.toFixed(2), max: RUBRIC['C_frontend'].points, note: artifacts.hasModuleLoading ? 'loading.tsx present' : 'missing loading.tsx' },
    'D_tests': { earned: d_tests.toFixed(2), max: RUBRIC['D_tests'].points, note: artifacts.hasRouteTests ? 'service tests present' : 'no service test files' },
    'D_typecheck': { earned: d_type.toFixed(2), max: RUBRIC['D_typecheck'].points, note: artifacts.hasTypecheck ? 'typecheck script present' : 'no typecheck script' },
    'D_playwright': { earned: d_play.toFixed(2), max: RUBRIC['D_playwright'].points, note: artifacts.hasPlaywright ? 'e2e spec present' : 'no playwright spec' },
  };

  const blockers = collectBlockers(moduleName, rows, checks, artifacts);

  return {
    module: moduleName,
    total,
    wired,
    missing,
    mismatch,
    wiredStr: `${wired}/${total}`,
    score: `${scoreNum}/10`,
    scoreNum,
    blockers,
    checks,
    topBlocker: blockers[0] ?? '—',
  };
}

// ── SCORECARD.md generation ─────────────────────────────────────────────────────

function buildScorecardMd(overall, moduleScores) {
  const lines = [
    '# CivitasOne Contract Scorecard',
    '',
    `**Overall: ${overall}/10**`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Module | Wired | Score | Top blocker |',
    '|--------|------:|------:|-------------|',
  ];

  for (const m of moduleScores) {
    if (m.scoreNum === null) {
      lines.push(`| ${m.module} | — | N/A | ${m.blockers[0] ?? '—'} |`);
      continue;
    }
    const blocker = (m.topBlocker ?? '—').replace(/\|/g, '\\|');
    lines.push(`| ${m.module} | ${m.wiredStr} | ${m.scoreNum}/10 | ${blocker} |`);
  }

  lines.push('');
  lines.push(`**Overall: ${overall}/10**`);
  lines.push('');
  return lines.join('\n');
}

function buildOrchestratorJson(overall, moduleScores) {
  const modules = {};
  const failing = [];

  for (const m of moduleScores) {
    if (m.scoreNum === null) continue;
    modules[m.module] = {
      score: m.scoreNum,
      wired: m.wiredStr,
      blockers: m.blockers,
    };
    if (m.scoreNum < 10) failing.push(m.module);
  }

  return { overall, modules, failing };
}

// ── Overall score ─────────────────────────────────────────────────────────────

function run() {
  const { rows, counts } = screenMap;
  const filtered = moduleFilter ? rows.filter((r) => r.module === moduleFilter) : rows;
  const modules = groupByModule(filtered);

  const moduleScores = [];
  for (const [moduleName, moduleRows] of modules) {
    moduleScores.push(scoreModule(moduleName, moduleRows));
  }
  moduleScores.sort((a, b) => (b.scoreNum ?? 0) - (a.scoreNum ?? 0));

  const scored = moduleScores.filter((m) => m.scoreNum !== null);
  const totalScreens = scored.reduce((s, m) => s + m.total, 0);
  const weightedSum = scored.reduce((s, m) => s + m.scoreNum * m.total, 0);
  const overall = totalScreens > 0 ? Math.round(10 * weightedSum / totalScreens) / 10 : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    overallScore: `${overall}/10`,
    overallScoreNum: overall,
    staticCounts: counts,
    modules: moduleScores,
    rubric: RUBRIC,
  };

  const orchestratorJson = buildOrchestratorJson(overall, moduleScores);
  const scorecardMd = buildScorecardMd(overall, moduleScores);

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(orchestratorJson, null, 2) + '\n');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'score-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT_DIR, 'score.json'), JSON.stringify(orchestratorJson, null, 2));
  writeFileSync(join(OUT_DIR, 'SCORECARD.md'), scorecardMd);

  process.stdout.write(scorecardMd + '\n');

  if (overall !== 10 || orchestratorJson.failing.length > 0) {
    process.exit(1);
  }
}

run();
