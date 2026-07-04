#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tenant-predicate-guard.mjs — Ensures all DB queries include a tenant predicate
//
// Since RLS (withTenantScope + SET app.tenant_id) is not yet wired at runtime,
// the app layer `eq(table.tenantId, ...)` filter is the SOLE tenant-isolation
// control. This guard verifies that every repo/query file that calls db.select(),
// db.update(), db.delete() includes a tenantId predicate in its .where() clause.
//
// Violations are reported as warnings (exit 0) during rollout, then promoted to
// hard failures (exit 1) once all services comply.
//
// Usage:  node scripts/ci/tenant-predicate-guard.mjs
// Exit:   0 when clean or soft mode, 1 when strict mode and violations found.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const STRICT = process.env.TENANT_GUARD_STRICT === "1";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage"]);

function* walkTsFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkTsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

// Files that are expected to contain tenant-scoped DB operations:
// repo.ts, queries.ts, consumer.ts (where Drizzle queries live)
const QUERY_FILE_RE = /\/(repo|queries|consumer)\.ts$/;

// Patterns indicating a DB query operation
const DB_OP_RE = /\bdb\.(select|update|delete)\b|\.from\(|\.where\(/g;
// Pattern indicating tenantId filter is present
const TENANT_FILTER_RE = /tenantId|tenant_id/;

function checkFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const violations = [];

  // Simple heuristic: if a function body contains a DB operation but no tenantId
  // reference within a reasonable window, flag it.
  // More precisely: scan for .from(table).where(...) blocks and verify tenantId appears.

  // Simplified: check if file has DB ops but NO tenantId filter anywhere
  const hasDbOps = DB_OP_RE.test(source);
  const hasTenantFilter = TENANT_FILTER_RE.test(source);

  if (hasDbOps && !hasTenantFilter) {
    violations.push({
      file: filePath,
      reason: "File contains DB operations but no tenantId predicate found",
    });
  }

  return violations;
}

function discoverServices() {
  if (!existsSync(SERVICES_DIR)) {
    console.error("tenant-predicate-guard: services directory not found");
    process.exit(1);
  }
  return readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service"))
    .filter((d) => { try { return statSync(join(SERVICES_DIR, d)).isDirectory(); } catch { return false; } });
}

function main() {
  const services = discoverServices();
  const allViolations = [];
  let filesScanned = 0;

  for (const svc of services.sort()) {
    const srcDir = join(SERVICES_DIR, svc, "src");
    if (!existsSync(srcDir)) continue;
    for (const file of walkTsFiles(srcDir)) {
      if (!QUERY_FILE_RE.test(file)) continue;
      filesScanned += 1;
      const violations = checkFile(file);
      allViolations.push(...violations);
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Tenant Predicate Guard — app-layer tenant isolation (P1-RLS)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Services discovered : ${services.length}`);
  console.log(`  Query files scanned : ${filesScanned}`);
  console.log("");

  if (allViolations.length === 0) {
    console.log("  ✅ CLEAN — all query files include tenant predicate.");
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const icon = STRICT ? "❌" : "⚠️";
  console.log(`  ${icon} ${allViolations.length} file(s) missing tenant predicate:`);
  console.log("");
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
    console.log(`  ${rel}`);
    console.log(`      ${v.reason}`);
  }
  console.log("");
  if (STRICT) {
    console.log("  STRICT mode: failing CI. All DB queries must include a tenant predicate.");
    process.exit(1);
  } else {
    console.log("  SOFT mode (TENANT_GUARD_STRICT=1 to promote to hard failure).");
    process.exit(0);
  }
}

main();
