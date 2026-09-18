#!/usr/bin/env node
// bundle-size-guard.mjs — PERF-009 tranche 3: turns tranche 2's "current
// size only" bundle report into a real before/after by diffing against a
// committed baseline, following this repo's established
// <name>-guard.mjs + <name>-baseline.json convention (see
// tenant-index-guard.mjs, jsx-a11y-ratchet-guard.mjs,
// contradictory-badge-guard.mjs, et al.).
//
// Parses `next build`'s own stdout table (the same /tmp/web-build.log the
// existing "Report bundle size" CI step in ci.yml already produces) rather
// than instrumenting the build itself, so this has zero build-time cost and
// can't drift from what Next.js actually shipped.
//
// Deliberately informational, not a hard gate: the existing "Report bundle
// size" step this extends is explicitly `if: always()` / "must never fail
// the job", and PERF-009's own DoD ("budgets set and enforced") is real
// remaining scope, not something this script claims to close. This is the
// *reporting* half — a real delta against a real baseline instead of an
// absolute number with nothing to compare it to.
//
// Usage:
//   node scripts/ci/bundle-size-guard.mjs <path-to-next-build-log> [--write-baseline] [--quiet]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASELINE_PATH = path.resolve(new URL(".", import.meta.url).pathname, "bundle-size-baseline.json");

const args = process.argv.slice(2);
const logPath = args.find((a) => !a.startsWith("--"));
const writeBaseline = args.includes("--write-baseline");
const quiet = args.includes("--quiet");

if (!logPath || !existsSync(logPath)) {
  console.error(
    `bundle-size-guard: no readable build log at ${logPath ?? "(none given)"} -- pass the path to ` +
    `next build's captured stdout (see ci.yml's "pnpm ... build | tee /tmp/web-build.log").`,
  );
  process.exit(quiet ? 0 : 1);
}

const log = readFileSync(logPath, "utf8");

/**
 * "4.02 kB" / "338 B" / "1.2 MB" -> a byte count. Self-consistent unit
 * (kB=1000), not claimed to match any OS-level byte-exact measurement --
 * only ever compared against another value produced by this same parser.
 */
function toBytes(sizeStr) {
  const m = sizeStr.trim().match(/^([\d.]+)\s*(B|kB|MB)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { B: 1, kB: 1000, MB: 1000000 }[m[2]];
  return Math.round(n * mult);
}

const ROUTE_LINE = /^[┌├└]\s+([○●ƒ])\s+(\S+)\s+([\d.]+\s*(?:kB|B|MB))\s+([\d.]+\s*(?:kB|B|MB))\s*$/;
const SHARED_LINE = /^\+ First Load JS shared by all\s+([\d.]+\s*(?:kB|B|MB))\s*$/;

const routes = {};
let sharedFirstLoadJsBytes = null;

for (const line of log.split("\n")) {
  const routeMatch = line.match(ROUTE_LINE);
  if (routeMatch) {
    const [, marker, routePath, sizeStr, firstLoadStr] = routeMatch;
    routes[routePath] = {
      marker,
      sizeBytes: toBytes(sizeStr),
      firstLoadJsBytes: toBytes(firstLoadStr),
    };
    continue;
  }
  const sharedMatch = line.match(SHARED_LINE);
  if (sharedMatch) {
    sharedFirstLoadJsBytes = toBytes(sharedMatch[1]);
  }
}

const routeCount = Object.keys(routes).length;
if (routeCount === 0 || sharedFirstLoadJsBytes === null) {
  console.error(
    `bundle-size-guard: parsed 0 routes or no shared-bundle line from ${logPath} -- the build may have ` +
    `failed before reaching its summary, or Next.js changed its output format. Not writing/comparing a ` +
    `baseline against an empty parse.`,
  );
  process.exit(quiet ? 0 : 1);
}

const current = {
  generatedAt: new Date().toISOString(),
  sharedFirstLoadJsBytes,
  routeCount,
  routes,
};

if (writeBaseline) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.error(`Wrote baseline: ${BASELINE_PATH} (${routeCount} routes, shared ${sharedFirstLoadJsBytes} B)`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.log(JSON.stringify({ sharedFirstLoadJsBytes, routeCount, baseline: null }, null, 2));
  console.error(
    "bundle-size-guard: no baseline committed yet -- run with --write-baseline once and commit " +
    "scripts/ci/bundle-size-baseline.json.",
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

// Noise floor: Next.js's own displayed sizes are already rounded (kB, 3 sig
// figs), so treat anything under this as measurement noise, not a real
// change -- clearly below the smallest real win a prior PERF-009 tranche
// reported (-3kB), while staying above ordinary build-to-build chunk-hash
// rounding jitter.
const NOISE_FLOOR_BYTES = 512;

const sharedDelta = sharedFirstLoadJsBytes - baseline.sharedFirstLoadJsBytes;

const added = [];
const removed = [];
const changed = [];
for (const [routePath, cur] of Object.entries(routes)) {
  const prev = baseline.routes[routePath];
  if (!prev) { added.push(routePath); continue; }
  const delta = cur.firstLoadJsBytes - prev.firstLoadJsBytes;
  if (Math.abs(delta) >= NOISE_FLOOR_BYTES) {
    changed.push({ route: routePath, before: prev.firstLoadJsBytes, after: cur.firstLoadJsBytes, delta });
  }
}
for (const routePath of Object.keys(baseline.routes)) {
  if (!routes[routePath]) removed.push(routePath);
}
changed.sort((a, b) => b.delta - a.delta);

const summary = {
  baselineGeneratedAt: baseline.generatedAt,
  sharedFirstLoadJsBytes: { before: baseline.sharedFirstLoadJsBytes, after: sharedFirstLoadJsBytes, delta: sharedDelta },
  routeCount: { before: baseline.routeCount, after: routeCount },
  routesAdded: added.length,
  routesRemoved: removed.length,
  routesChangedBeyondNoiseFloor: changed.length,
};

console.log(JSON.stringify(summary, null, 2));

if (!quiet) {
  if (Math.abs(sharedDelta) >= NOISE_FLOOR_BYTES) {
    console.log(`\nShared First Load JS: ${baseline.sharedFirstLoadJsBytes} B -> ${sharedFirstLoadJsBytes} B (${sharedDelta > 0 ? "+" : ""}${sharedDelta} B)`);
  }
  if (changed.length > 0) {
    console.log(`\nRoutes changed beyond the ${NOISE_FLOOR_BYTES} B noise floor (largest first):`);
    for (const c of changed.slice(0, 25)) {
      console.log(`  ${c.delta > 0 ? "+" : ""}${c.delta} B  ${c.route}  (${c.before} -> ${c.after})`);
    }
    if (changed.length > 25) console.log(`  ... and ${changed.length - 25} more`);
  }
  if (added.length > 0) console.log(`\nNew routes since baseline: ${added.join(", ")}`);
  if (removed.length > 0) console.log(`\nRemoved routes since baseline: ${removed.join(", ")}`);
  if (changed.length === 0 && added.length === 0 && removed.length === 0 && Math.abs(sharedDelta) < NOISE_FLOOR_BYTES) {
    console.log("\nNo route or shared-bundle changes beyond the noise floor.");
  }
}

// Deliberately always exit 0 -- see the header comment and this tranche's
// PR description for why this stays a report, not a gate, for now.
process.exit(0);
