#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// pagination-audit.mjs — Unbounded query detector
//
// Scans all services/*/src/modules/*/repo.ts files and flags any
// db.select().from(...) call chain that does NOT include .limit(...).
//
// EXCLUDES:
//   - Single-row lookups: functions with findById pattern using .limit(1)
//   - Lines with `// pagination-audit-safe` whitelist comment
//   - Aggregate queries (SUM, COUNT, etc.) which don't return row sets
//
// Usage: node scripts/ci/pagination-audit.mjs
// Exit:  0 if all queries are bounded or whitelisted; 1 if unbounded found.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── 1. Discover repo.ts files ────────────────────────────────────────────────
function discoverRepoFiles() {
  const files = [];
  if (!existsSync(SERVICES_DIR)) return files;

  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  for (const svc of services) {
    const modulesDir = join(SERVICES_DIR, svc, "src", "modules");
    if (!existsSync(modulesDir)) continue;

    const modules = readdirSync(modulesDir).filter((d) => {
      try { return statSync(join(modulesDir, d)).isDirectory(); }
      catch { return false; }
    });

    for (const mod of modules) {
      const repoFile = join(modulesDir, mod, "repo.ts");
      if (existsSync(repoFile)) files.push(repoFile);
    }
  }
  return files;
}

// ── 2. Analyze a repo file for unbounded selects ─────────────────────────────

// We look for db.select().from( or (tx as typeof db).select().from(
// Then check if within the same logical statement (up to the next semicolon/return)
// there is a .limit( call.

function analyzeFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const violations = [];

  // Multi-line statement accumulator
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip whitelisted lines
    if (line.includes("// pagination-audit-safe")) continue;

    // Detect select().from( pattern
    if (!line.match(/\.select\s*\(\s*\)\.from\s*\(/)) continue;

    // Skip aggregate queries (they don't return unbounded rows)
    if (line.match(/\b(sum|count|avg|min|max)\b/i)) continue;

    // Accumulate the full statement (look ahead until ; or closing })
    let statement = line;
    let j = i + 1;
    while (j < lines.length && j < i + 15) { // look ahead max 15 lines
      const nextLine = lines[j];
      statement += " " + nextLine;
      if (nextLine.includes(";") || nextLine.match(/^\s*\}\s*$/)) break;
      j++;
    }

    // Check if statement has .limit(
    if (statement.match(/\.limit\s*\(/)) continue;

    // Check if it's an aggregate query in the accumulated statement
    if (statement.match(/\b(sum|count|avg|min|max|coalesce)\s*\(/i)) continue;

    // Check the whitelist comment in accumulated lines
    let whitelisted = false;
    for (let k = i; k <= j && k < lines.length; k++) {
      if (lines[k].includes("// pagination-audit-safe")) {
        whitelisted = true;
        break;
      }
    }
    if (whitelisted) continue;

    // Extract table reference from the .from( call
    const tableMatch = line.match(/\.from\s*\(\s*(\w+)/);
    const tableName = tableMatch ? tableMatch[1] : "<unknown>";

    violations.push({
      line: i + 1,
      table: tableName,
      snippet: line.trim().slice(0, 100),
    });
  }

  return violations;
}

// ── 3. Run ────────────────────────────────────────────────────────────────────
function main() {
  const repoFiles = discoverRepoFiles();
  const allViolations = [];
  let totalQueries = 0;

  for (const file of repoFiles) {
    const violations = analyzeFile(file);
    totalQueries += countSelects(file);
    for (const v of violations) {
      allViolations.push({ file, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Pagination Audit — Unbounded Query Detector");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Repo files scanned : ${repoFiles.length}`);
  console.log(`  SELECT queries found: ${totalQueries}`);
  console.log("");

  if (allViolations.length === 0) {
    console.log(`  ${GREEN}✅ PASS — all queries are bounded with .limit() or whitelisted.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  console.log(`  ${RED}${BOLD}❌ ${allViolations.length} unbounded query(ies) detected:${RESET}`);
  console.log("");
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file);
    console.log(`  ${RED}[UNBOUNDED]${RESET} ${rel}:${v.line}`);
    console.log(`      table: ${v.table}`);
    console.log(`      ${v.snippet}`);
    console.log("");
  }
  console.log(`  ${YELLOW}Fix: add .limit(N) to bound the result set, or add${RESET}`);
  console.log(`  ${YELLOW}// pagination-audit-safe to whitelist intentional unbounded queries.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

function countSelects(filePath) {
  const source = readFileSync(filePath, "utf8");
  const matches = source.match(/\.select\s*\(\s*\)\.from\s*\(/g);
  return matches ? matches.length : 0;
}

main();
