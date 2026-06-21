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
 * Usage:
 *   node scripts/contract/score.mjs
 *   node scripts/contract/score.mjs --module finance
 *   node scripts/contract/score.mjs --json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const args = process.argv.slice(2);
const moduleFilter = args[args.indexOf('--module') + 1] ?? null;
const jsonOnly = args.includes('--json');

// ── Rubric weights ────────────────────────────────────────────────────────────
// Each rubric check contributes to a 0–10 score.
// The checks we can evaluate statically are in Section A.
// We report what we can, flag what requires live infra.

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

const TOTAL_POINTS = Object.values(RUBRIC).reduce((s, r) => s + r.points, 0); // 10.0

// ── Load data files ───────────────────────────────────────────────────────────

function loadJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

const screenMap = loadJSON(join(ROOT, 'scripts/contract/screen-map.json'));
const verifyReport = loadJSON(join(ROOT, 'scripts/contract/verify-report.json'));

if (!screenMap) {
  process.stderr.write('ERROR: screen-map.json not found. Run: node scripts/contract/screen-map.mjs\n');
  process.exit(1);
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

function scoreModule(moduleName, rows) {
  // Filter to screens that have loaders (skip NO_LOADER hub pages for scoring)
  const loaderScreens = rows.filter(r => r.status !== 'NO_LOADER');
  const total = loaderScreens.length;

  if (total === 0) {
    return {
      module: moduleName,
      total: 0,
      score: 'N/A',
      scoreNum: null,
      checks: {},
      detail: 'No loader screens (navigation hub only)',
    };
  }

  const wired = loaderScreens.filter(r => r.status === 'WIRED').length;
  const missing = loaderScreens.filter(r => r.status === 'MISSING').length;
  const mismatch = loaderScreens.filter(r => r.status === 'MISMATCH').length;
  const wiredPct = wired / total;

  // A1: gateway resolves
  const gatewayOk = loaderScreens.filter(r => r.upstream !== null).length;
  const a1 = RUBRIC['A1_gateway_resolves'].points * (gatewayOk / total);

  // A2: route exists
  const routeOk = loaderScreens.filter(r => r.routeHandler !== null).length;
  const a2 = RUBRIC['A2_route_exists'].points * (routeOk / total);

  // A3: table exists
  const tableOk = loaderScreens.filter(r => r.tablesPresent === true).length;
  const a3 = RUBRIC['A3_table_exists'].points * (tableOk / total);

  // A4: live verify (from verify-report.json)
  let a4 = 0;
  let liveTestedPaths = 0;
  let livePassedPaths = 0;
  if (verifyReport) {
    const moduleApiPaths = new Set(loaderScreens.flatMap(r => r.apiPaths));
    const moduleResults = verifyReport.results.filter(r => r.module === moduleName);
    liveTestedPaths = moduleResults.length;
    livePassedPaths = moduleResults.filter(r => r.verdict === 'PASS').length;
    const emptyPaths = moduleResults.filter(r => r.verdict === 'EMPTY').length;
    // EMPTY counts as partial credit (0.5) since HTTP 200 works, just no seed data
    const liveScore = livePassedPaths + emptyPaths * 0.5;
    a4 = liveTestedPaths > 0
      ? RUBRIC['A4_live_200'].points * (liveScore / liveTestedPaths)
      : 0;
  }

  // B, C, D: These require manual verification or CI runs.
  // We award partial static credit for B when hardening patterns are visible.
  // For the automated score, we can check if service has auth + zod patterns.
  const bCredit = wiredPct; // Proxy: if chain is wired, assume hardening is also present
  const b = RUBRIC['B_hardening'].points * bCredit;

  // C, D: Mark as UNKNOWN (0) until manually verified or CI passes
  const c = 0;
  const d_tests = 0;
  const d_type = 0;
  const d_play = 0;

  const rawScore = a1 + a2 + a3 + a4 + b + c + d_tests + d_type + d_play;
  const scoreNum = Math.min(10, Math.round(rawScore * 10) / 10);

  return {
    module: moduleName,
    total,
    wired, missing, mismatch,
    score: `${scoreNum}/10`,
    scoreNum,
    checks: {
      'A1_gateway_resolves': { earned: a1.toFixed(2), max: RUBRIC['A1_gateway_resolves'].points, pct: pct(gatewayOk, total) },
      'A2_route_exists': { earned: a2.toFixed(2), max: RUBRIC['A2_route_exists'].points, pct: pct(routeOk, total) },
      'A3_table_exists': { earned: a3.toFixed(2), max: RUBRIC['A3_table_exists'].points, pct: pct(tableOk, total) },
      'A4_live_200': { earned: a4.toFixed(2), max: RUBRIC['A4_live_200'].points, liveTestedPaths, livePassedPaths, note: verifyReport ? '' : 'run verify-screens.mjs for live score' },
      'B_hardening': { earned: b.toFixed(2), max: RUBRIC['B_hardening'].points, note: 'static proxy via chain wired%' },
      'C_frontend': { earned: c.toFixed(2), max: RUBRIC['C_frontend'].points, note: 'manual / playwright' },
      'D_tests': { earned: d_tests.toFixed(2), max: RUBRIC['D_tests'].points, note: 'run pnpm test --filter' },
      'D_typecheck': { earned: d_type.toFixed(2), max: RUBRIC['D_typecheck'].points, note: 'run pnpm typecheck --filter' },
      'D_playwright': { earned: d_play.toFixed(2), max: RUBRIC['D_playwright'].points, note: 'playwright E2E' },
    },
  };
}

function pct(n, total) { return total > 0 ? `${Math.round(100 * n / total)}%` : '0%'; }

// ── Overall score ─────────────────────────────────────────────────────────────

function run() {
  const { rows, counts } = screenMap;
  const filtered = moduleFilter ? rows.filter(r => r.module === moduleFilter) : rows;
  const modules = groupByModule(filtered);

  const moduleScores = [];
  for (const [moduleName, moduleRows] of modules) {
    moduleScores.push(scoreModule(moduleName, moduleRows));
  }

  // Weighted overall (by screen count)
  const scored = moduleScores.filter(m => m.scoreNum !== null);
  const totalScreens = scored.reduce((s, m) => s + m.total, 0);
  const weightedSum = scored.reduce((s, m) => s + m.scoreNum * m.total, 0);
  const overall = totalScreens > 0 ? Math.round(10 * weightedSum / totalScreens) / 10 : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    overallScore: `${overall}/10`,
    overallScoreNum: overall,
    staticCounts: counts,
    modules: moduleScores.sort((a, b) => (b.scoreNum ?? 0) - (a.scoreNum ?? 0)),
    rubric: RUBRIC,
  };

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  // ── Write JSON report ──────────────────────────────────────────────────────
  const outDir = join(ROOT, 'scripts/contract');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'score-report.json'), JSON.stringify(report, null, 2));

  // ── Console scorecard ──────────────────────────────────────────────────────
  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════════════════╗\n');
  process.stdout.write('║   CIVITASONE CONTRACT SCORECARD                         ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════════════╝\n');
  process.stdout.write('\n');
  process.stdout.write(`  OVERALL SCORE: ${overall}/10\n\n`);

  process.stdout.write(`  ${'MODULE'.padEnd(24)} ${'SCORE'.padEnd(8)} ${'WIRED'.padEnd(8)} ${'MISSING'.padEnd(10)} MISMATCH\n`);
  process.stdout.write(`  ${'─'.repeat(62)}\n`);

  for (const m of moduleScores) {
    if (m.scoreNum === null) {
      process.stdout.write(`  ${m.module.padEnd(24)} ${'N/A'.padEnd(8)} ${'—'.padEnd(8)} ${'—'.padEnd(10)} —\n`);
      continue;
    }
    const scoreStr = `${m.score}`;
    const icon = m.scoreNum >= 8 ? '✅' : m.scoreNum >= 5 ? '⚠️' : '❌';
    process.stdout.write(`  ${m.module.padEnd(24)} ${(icon + ' ' + scoreStr).padEnd(14)} ${String(m.wired ?? 0).padEnd(8)} ${String(m.missing ?? 0).padEnd(10)} ${m.mismatch ?? 0}\n`);
  }

  process.stdout.write(`\n  ${'─'.repeat(62)}\n`);
  process.stdout.write(`  ${'TOTAL'.padEnd(24)} ${overall}/10\n\n`);

  process.stdout.write('  Rubric section weights:\n');
  for (const [key, r] of Object.entries(RUBRIC)) {
    process.stdout.write(`    ${key.padEnd(22)} ${String(r.points).padEnd(5)} pts  ${r.desc}\n`);
  }

  process.stdout.write('\n  To get to 10/10:\n');
  process.stdout.write('    1. Fix all MISSING/MISMATCH chains (screen-map.mjs)\n');
  process.stdout.write('    2. Run verify-screens.mjs (needs running services)\n');
  process.stdout.write('    3. Pass pnpm test + typecheck + playwright\n');
  process.stdout.write('\n  Output: scripts/contract/score-report.json\n\n');
}

run();
