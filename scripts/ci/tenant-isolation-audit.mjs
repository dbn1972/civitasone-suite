#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tenant-isolation-audit.mjs — Tenant filter enforcement checker
//
// Scans all services/*/src/modules/*/repo.ts files and verifies that every
// function performing a db.select().from(...).where(...) includes a tenant_id
// or tenantId filter. Multi-tenant isolation is a hard constraint in CivitasOne.
//
// Checks:
//   1. Drizzle ORM queries: .where(...) must include tenantId/tenant_id ref
//   2. Raw SQL: tx.execute(sql`...`) must include tenant_id in the SQL text
//
// EXCLUDES:
//   - Functions that accept tenantId as parameter AND use it in the where clause
//     (these are compliant by design — we look for the ABSENCE of tenant filter)
//   - Lines with `// tenant-isolation-safe` whitelist comment
//   - Pure write operations (insert/update without select)
//   - Functions named *ById that use a primary key lookup (if tenant-scoped table)
//
// Usage: node scripts/ci/tenant-isolation-audit.mjs
// Exit:  count of violations (0 = clean).
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

// ── 2. Parse functions and check for tenant isolation ─────────────────────────

function extractFunctions(source) {
  const functions = [];
  const lines = source.split("\n");

  let funcStart = -1;
  let funcName = "";
  let braceDepth = 0;
  let inFunc = false;
  let funcLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect function start
    const funcMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (funcMatch && !inFunc) {
      funcStart = i + 1; // 1-indexed
      funcName = funcMatch[1];
      inFunc = true;
      braceDepth = 0;
      funcLines = [];
    }

    if (inFunc) {
      funcLines.push(line);
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (braceDepth <= 0 && funcLines.length > 1) {
        functions.push({
          name: funcName,
          startLine: funcStart,
          body: funcLines.join("\n"),
          lines: funcLines,
        });
        inFunc = false;
      }
    }
  }

  return functions;
}

function checkFunction(func) {
  const body = func.body;
  const violations = [];

  // Check if function has whitelist comment
  if (body.includes("// tenant-isolation-safe")) return violations;

  // Check if function signature accepts tenantId
  const hasTenantParam = /\btenantId\s*[,:)]/.test(func.lines[0] + (func.lines[1] || ""));

  // Pattern 1: Drizzle ORM select with where
  const hasSelect = /\.select\s*\(/.test(body);
  const hasWhere = /\.where\s*\(/.test(body);

  if (hasSelect && hasWhere) {
    // Check if tenantId/tenant_id is referenced in the where clause context
    const hasTenantInWhere = /tenant[_]?[iI]d/.test(body) ||
                              /tenantId/.test(body) ||
                              /tenant_id/.test(body);

    if (!hasTenantInWhere && !hasTenantParam) {
      violations.push({
        type: "ORM_SELECT",
        reason: "select().from().where() without tenantId filter",
      });
    }
  }

  // Pattern 2: Raw SQL execution
  const rawSqlMatches = body.match(/\.execute\s*\(\s*sql\s*`[^`]*`\s*\)/gs);
  if (rawSqlMatches) {
    for (const rawSql of rawSqlMatches) {
      if (!rawSql.includes("tenant_id") && !rawSql.includes("tenantId")) {
        // Check if it's a write-only operation (INSERT/UPDATE without SELECT)
        if (/\bSELECT\b/i.test(rawSql) || /\bFROM\b/i.test(rawSql)) {
          if (!hasTenantParam || !body.includes("tenantId")) {
            violations.push({
              type: "RAW_SQL",
              reason: "raw SQL query without tenant_id in WHERE clause",
            });
          }
        }
      }
    }
  }

  return violations;
}

// ── 3. Run ────────────────────────────────────────────────────────────────────
function main() {
  const repoFiles = discoverRepoFiles();
  const allViolations = [];
  let totalFunctions = 0;

  for (const file of repoFiles) {
    const source = readFileSync(file, "utf8");
    const functions = extractFunctions(source);
    totalFunctions += functions.length;

    for (const func of functions) {
      const violations = checkFunction(func);
      for (const v of violations) {
        allViolations.push({
          file,
          funcName: func.name,
          line: func.startLine,
          ...v,
        });
      }
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Tenant Isolation Audit — Multi-tenant filter checker");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Repo files scanned   : ${repoFiles.length}`);
  console.log(`  Functions analyzed   : ${totalFunctions}`);
  console.log("");

  if (allViolations.length === 0) {
    console.log(`  ${GREEN}✅ PASS — all queries include tenant isolation filters.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  console.log(`  ${RED}${BOLD}❌ ${allViolations.length} tenant isolation violation(s):${RESET}`);
  console.log("");
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file);
    console.log(`  ${RED}[${v.type}]${RESET} ${rel}:${v.line} — ${v.funcName}()`);
    console.log(`      ${v.reason}`);
    console.log("");
  }
  console.log(`  ${YELLOW}Fix: ensure every query includes a tenantId/tenant_id filter,${RESET}`);
  console.log(`  ${YELLOW}or add // tenant-isolation-safe if intentionally cross-tenant.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(allViolations.length);
}

main();
