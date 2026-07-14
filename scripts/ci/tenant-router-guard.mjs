#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tenant-router-guard.mjs — Fleet-wide TenantRouter adoption guard (Req 1.7)
//
// `TenantRouter` (tiered pool/silo/shard connection routing) exists in
// `packages/db`, but adoption across the 33 DB_Backed_Service instances is a
// fleet-wide rollout (task 4.4). This guard closes Requirement 1.7: it scans
// every `services/<svc>-service/src/shared/db.ts` and FAILS (exit 1) if a
// service's `shared/db.ts` calls `createSqlClient(` directly to build its own
// pool-tier client, instead of going through the Tenant_Router.
//
// A `shared/db.ts` is considered COMPLIANT if either:
//   (a) it calls `createTenantDb(` — the new packages/db factory (task 1.1)
//       that wraps `createSqlClient()` internally, OR
//   (b) it follows the existing hand-rolled estab-service pattern: imports
//       `TenantRouter` from "@civitasone/db" AND constructs one via
//       `new TenantRouter(...)`.
//
// A file is a VIOLATION if it calls `createSqlClient(` directly for its own
// pool-tier client and does NOT satisfy (a) or (b) above — i.e. it bypasses
// tenant routing entirely.
//
// This guard intentionally scans ONLY `services/*/src/shared/db.ts` — not
// every `.ts` file, and not `packages/db` itself (whose own `create-tenant-db.ts`
// and `tenant-router.ts` legitimately call `createSqlClient` internally; that's
// the implementation, not a bypass).
//
// Best-effort: line and block comments are stripped before matching. Pure Node
// ESM, no external dependencies — mirrors `scripts/ci/arch-guard.mjs`.
//
// Usage:  node scripts/ci/tenant-router-guard.mjs      (from repo root)
// Exit:   0 when clean, 1 when any violation is found.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ci/tenant-router-guard.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ── 1. Discover services ────────────────────────────────────────────────────
// A service folder is `services/<svc>-service`; its guarded file is
// `services/<svc>-service/src/shared/db.ts`.
function discoverServices() {
  if (!existsSync(SERVICES_DIR)) {
    console.error(`tenant-router-guard: services directory not found at ${SERVICES_DIR}`);
    process.exit(1);
  }
  return readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service"))
    .filter((d) => {
      try {
        return statSync(join(SERVICES_DIR, d)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

// ── 2. Comment stripping (best-effort) ──────────────────────────────────────
// Removes /* ... */ block comments (possibly multi-line) and // line comments,
// while preserving overall line count so reported line numbers stay accurate.
// String literals are not perfectly respected, but for `//` inside strings we
// only risk *under*-reporting on that line, which keeps the guard conservative.
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push(""); // entire line is inside a block comment
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    // Remove inline block comments on this line; handle an unterminated one.
    let result = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (two === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          inBlock = true;
          break; // rest of line is comment
        }
        result += " ".repeat(end + 2 - i);
        i = end + 2;
      } else if (two === "//") {
        break; // rest of line is a line comment
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out;
}

// ── 3. Violation detection ───────────────────────────────────────────────────
const CREATE_SQL_CLIENT_CALL_RE = /\bcreateSqlClient\s*\(/;
const CREATE_TENANT_DB_CALL_RE = /\bcreateTenantDb\s*\(/;
const NEW_TENANT_ROUTER_RE = /\bnew\s+TenantRouter\s*\(/;

// Matches an import/require specifier list + module string, e.g.
//   import { createSqlClient, TenantRouter } from "@civitasone/db";
// Captures the imported-names blob and the module specifier separately so we
// can check "TenantRouter" is a *named import*, not merely mentioned in a
// comment or string elsewhere.
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

function checkFile(source) {
  const lines = stripComments(source);
  const stripped = lines.join("\n");

  const hasCreateSqlClientCall = CREATE_SQL_CLIENT_CALL_RE.test(stripped);
  const hasCreateTenantDbCall = CREATE_TENANT_DB_CALL_RE.test(stripped);

  let importsTenantRouterFromDb = false;
  IMPORT_RE.lastIndex = 0;
  let im;
  while ((im = IMPORT_RE.exec(stripped)) !== null) {
    const [, names, spec] = im;
    if (spec === "@civitasone/db") {
      const imported = names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      if (imported.includes("TenantRouter")) {
        importsTenantRouterFromDb = true;
      }
    }
  }
  const constructsTenantRouter = NEW_TENANT_ROUTER_RE.test(stripped);
  const usesTenantRouterPattern = importsTenantRouterFromDb && constructsTenantRouter;

  const isCompliant = hasCreateTenantDbCall || usesTenantRouterPattern;

  if (!hasCreateSqlClientCall || isCompliant) {
    return [];
  }

  // Report every direct createSqlClient( call-site line (not the import line —
  // named imports never have `(` immediately after the identifier).
  const violations = [];
  lines.forEach((line, idx) => {
    if (CREATE_SQL_CLIENT_CALL_RE.test(line)) {
      violations.push({ line: idx + 1, snippet: line.trim() });
    }
  });
  return violations;
}

// ── 4. Run ────────────────────────────────────────────────────────────────────
function main() {
  const services = discoverServices();
  const allViolations = [];
  let filesScanned = 0;
  let filesMissing = 0;

  for (const svcDir of services) {
    const svc = svcDir.slice(0, -"-service".length);
    const dbFile = join(SERVICES_DIR, svcDir, "src", "shared", "db.ts");
    if (!existsSync(dbFile)) {
      filesMissing += 1;
      continue;
    }
    filesScanned += 1;
    const source = readFileSync(dbFile, "utf8");
    const found = checkFile(source);
    for (const v of found) {
      allViolations.push({ file: dbFile, owner: svc, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Tenant Router Guard — fleet-wide TenantRouter adoption (Req 1.7)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Services discovered   : ${services.length}`);
  console.log(`  shared/db.ts scanned  : ${filesScanned}`);
  if (filesMissing > 0) {
    console.log(`  shared/db.ts missing  : ${filesMissing} (skipped)`);
  }
  console.log("");

  if (allViolations.length === 0) {
    console.log("  ✅ CLEAN — every shared/db.ts goes through createTenantDb() or TenantRouter.");
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  console.log(`  ❌ ${allViolations.length} violation(s) detected across ${new Set(allViolations.map((v) => v.owner)).size} service(s):`);
  console.log("");
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
    console.log(`  [DIRECT-SQL-CLIENT] ${rel}:${v.line}`);
    console.log(`      ${v.owner}-service calls createSqlClient() directly instead of going through`);
    console.log(`      createTenantDb() (or the TenantRouter pattern): ${v.snippet}`);
  }
  console.log("");
  console.log(`  Every DB_Backed_Service's shared/db.ts must route through createTenantDb()`);
  console.log(`  (packages/db/src/create-tenant-db.ts) so tenant isolation tiers are enforced`);
  console.log(`  consistently across the fleet. See scripts/codemod/adopt-tenant-router.mjs.`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

main();
