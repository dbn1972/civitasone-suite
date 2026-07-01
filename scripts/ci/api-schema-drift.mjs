#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// api-schema-drift.mjs — API route baseline & backward-compatibility checker
//
// For each service, reads the routes.ts files and extracts all registered
// HTTP routes (method + path). Compares against a baseline JSON file.
//
// First run: generates the baseline (tests/contract/api-baseline.json).
// Subsequent runs: diffs against baseline and reports:
//   - NEW routes (informational, OK)
//   - REMOVED routes (BREAKING — exit 1)
//   - CHANGED method routes (BREAKING — exit 1)
//
// Usage: node scripts/ci/api-schema-drift.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const BASELINE_PATH = join(REPO_ROOT, "tests", "contract", "api-baseline.json");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── Route Extraction ─────────────────────────────────────────────────────────

// Matches Fastify route registration patterns:
// app.get("/v1/...", ...)
// app.post("/v1/...", ...)
// app.patch("/v1/...", ...)
// app.put("/v1/...", ...)
// app.delete("/v1/...", ...)
const ROUTE_REGEX = /app\.(get|post|put|patch|delete|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

function extractRoutesFromFile(filePath) {
  const routes = [];
  let content;
  try { content = readFileSync(filePath, "utf8"); }
  catch { return routes; }

  let match;
  ROUTE_REGEX.lastIndex = 0;
  const regex = new RegExp(ROUTE_REGEX.source, ROUTE_REGEX.flags);
  while ((match = regex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];
    // Skip health/metrics endpoints
    if (path === "/health" || path === "/ready" || path === "/metrics") continue;
    routes.push({ method, path });
  }

  return routes;
}

function findRouteFiles(serviceDir) {
  const files = [];

  function walk(dir) {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir); }
    catch { return; }

    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (entry === "routes.ts" || entry.endsWith("-routes.ts")) {
          files.push(fullPath);
        }
      } catch { /* skip */ }
    }
  }

  walk(join(serviceDir, "src"));
  return files;
}

// ── Main Logic ───────────────────────────────────────────────────────────────

function discoverAllRoutes() {
  const result = {};

  if (!existsSync(SERVICES_DIR)) return result;

  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  for (const svc of services) {
    const svcDir = join(SERVICES_DIR, svc);
    const routeFiles = findRouteFiles(svcDir);
    const routes = [];

    for (const rf of routeFiles) {
      routes.push(...extractRoutesFromFile(rf));
    }

    // Deduplicate
    const unique = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()];
    unique.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    if (unique.length > 0) {
      result[svc] = unique;
    }
  }

  return result;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveBaseline(routes) {
  const dir = dirname(BASELINE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(routes, null, 2) + "\n", "utf8");
}

function computeDiff(baseline, current) {
  const added = [];
  const removed = [];

  // Build lookup sets
  const baseSet = new Map();
  const currSet = new Map();

  for (const [svc, routes] of Object.entries(baseline)) {
    for (const r of routes) {
      baseSet.set(`${svc}|${r.method}|${r.path}`, { service: svc, ...r });
    }
  }

  for (const [svc, routes] of Object.entries(current)) {
    for (const r of routes) {
      currSet.set(`${svc}|${r.method}|${r.path}`, { service: svc, ...r });
    }
  }

  // Find added routes (in current but not in baseline)
  for (const [key, route] of currSet) {
    if (!baseSet.has(key)) {
      added.push(route);
    }
  }

  // Find removed routes (in baseline but not in current)
  for (const [key, route] of baseSet) {
    if (!currSet.has(key)) {
      removed.push(route);
    }
  }

  return { added, removed };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();

  const currentRoutes = discoverAllRoutes();
  const totalRoutes = Object.values(currentRoutes).reduce((sum, r) => sum + r.length, 0);
  const serviceCount = Object.keys(currentRoutes).length;

  const baseline = loadBaseline();
  const elapsed = Date.now() - startTime;

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  API Schema Drift Detector — Route backward-compat check");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Services scanned : ${serviceCount}`);
  console.log(`  Total routes     : ${totalRoutes}`);
  console.log(`  Scan time        : ${elapsed}ms`);
  console.log("");

  // First run — generate baseline
  if (!baseline) {
    saveBaseline(currentRoutes);
    console.log(`  ${CYAN}ℹ️  First run — baseline generated:${RESET}`);
    console.log(`    ${DIM}${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("");
    console.log(`  ${GREEN}${BOLD}✅ Baseline created with ${totalRoutes} routes across ${serviceCount} services.${RESET}`);
    console.log("");

    // Print summary by service
    for (const [svc, routes] of Object.entries(currentRoutes)) {
      console.log(`  ${DIM}${svc}:${RESET} ${routes.length} routes`);
    }

    console.log("══════════════════════════════════════════════════════════════");
    process.exit(0);
  }

  // Subsequent run — diff against baseline
  const { added, removed } = computeDiff(baseline, currentRoutes);

  console.log(`  Baseline routes  : ${Object.values(baseline).reduce((s, r) => s + r.length, 0)}`);
  console.log(`  Current routes   : ${totalRoutes}`);
  console.log(`  New routes       : ${added.length}`);
  console.log(`  Removed routes   : ${removed.length}`);
  console.log("");

  if (added.length > 0) {
    console.log(`  ${GREEN}[NEW] ${added.length} route(s) added (non-breaking):${RESET}`);
    for (const r of added) {
      console.log(`    ${GREEN}+${RESET} ${r.method} ${r.path} ${DIM}(${r.service})${RESET}`);
    }
    console.log("");
  }

  if (removed.length > 0) {
    console.log(`  ${RED}${BOLD}[REMOVED] ${removed.length} route(s) removed (BREAKING):${RESET}`);
    for (const r of removed) {
      console.log(`    ${RED}-${RESET} ${r.method} ${r.path} ${DIM}(${r.service})${RESET}`);
    }
    console.log("");
  }

  if (removed.length > 0) {
    console.log(`  ${RED}${BOLD}❌ FAIL — backward-incompatible route removal detected.${RESET}`);
    console.log(`  ${YELLOW}Fix: deprecated routes must remain until the next major version.${RESET}`);
    console.log(`  ${YELLOW}If intentional, update the baseline: node scripts/ci/api-schema-drift.mjs --update${RESET}`);
    console.log("══════════════════════════════════════════════════════════════");

    // Check if --update flag passed
    if (process.argv.includes("--update")) {
      saveBaseline(currentRoutes);
      console.log(`  ${CYAN}Baseline updated.${RESET}`);
      process.exit(0);
    }

    process.exit(1);
  }

  // Update baseline with new routes (additive changes are safe)
  if (added.length > 0) {
    saveBaseline(currentRoutes);
    console.log(`  ${DIM}Baseline updated with ${added.length} new route(s).${RESET}`);
  }

  console.log(`  ${GREEN}${BOLD}✅ PASS — no backward-incompatible changes.${RESET}`);
  console.log("══════════════════════════════════════════════════════════════");
  process.exit(0);
}

main();
