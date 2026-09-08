#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// raw-session-guc-guard.mjs — PgBouncer transaction-pool session-leak guard
// (PERF-001 fix-up)
//
// PERF-001 routes the whole fleet through PgBouncer with `pool_mode =
// transaction`. Under transaction pooling a backend server connection is
// handed to a DIFFERENT client the instant the current transaction ends, and
// (see infra/pgbouncer/pgbouncer.ini) PgBouncer only guarantees a full
// `server_reset_query` between handoffs when `server_reset_query_always = 1`
// is also set. Any code that sets a session-scoped Postgres GUC — a raw
// `SET app.tenant_id = ...` (not `SET LOCAL`), or `set_config('app.foo', v,
// false)` (`is_local=false`) — leaves that value sitting on the shared
// backend connection for whichever unrelated client the pool hands it to
// next. For a tenant-scoping GUC this is a cross-tenant data leak; live-
// reproduced against an isolated PgBouncer built from this repo's exact
// pooling config (raw `SET app.tenant_id` on one client, visible from 5
// separate subsequent client connections through the pool).
//
// Two production migrations (services/finance-service/migrations/0070_*.sql,
// services/notification-service/migrations/0044_*.sql) shipped exactly this
// pattern; this guard exists so a third one can't.
//
// COMPLIANT: `SET LOCAL app.foo = ...` / `set_config('app.foo', v, true)`
//            (transaction-scoped — cleared automatically at commit/rollback,
//            same guarantee `server_reset_query_always` gives PgBouncer;
//            packages/db/src/raw-tenant-guc.ts's `withRawTenantGuc` and
//            services/audit-service/migrations/0025_*.sql are the
//            established patterns).
// VIOLATION: `SET app.foo = ...` / `SET SESSION app.foo = ...` (session-
//            scoped) / `set_config('app.foo', v, false)`.
//
// A RELATED BUT SEPARATE check flags non-transaction-scoped advisory locks
// (`pg_advisory_lock`/`pg_try_advisory_lock`/`..._shared`, as opposed to the
// `..._xact_...` variants) fleet-wide. Same underlying risk shape (session
// state that outlives one transaction, silently inherited by the pool's next
// client) even though the specific mechanism (advisory lock, not a tenant
// GUC) is lower severity — a stuck/leaked lock, not a cross-tenant data leak.
//
// Scans every `.sql` file under `services/*/migrations/`, and every
// `.ts`/`.mjs` file under `services/*/src/` / `packages/*/src/` — the paths
// that actually run against the pooled connection in production. See
// `discoverFiles()` below for why `tests/`/`integration/`/`scripts/seed/`
// are deliberately out of scope for enforcement (a real, tracked, lower-
// priority finding, not an oversight).
//
// Best-effort comment stripping (SQL `--`/`/* */`, JS/TS `//`/`/* */`) before
// matching, string literals not perfectly respected — conservative in the
// same direction as scripts/ci/tenant-router-guard.mjs (risk is under-, not
// over-, reporting inside a string literal, never the reverse).
//
// Usage:  node scripts/ci/raw-session-guc-guard.mjs      (from repo root)
// Exit:   0 when clean, 1 when any violation is found (either check).
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ci/raw-session-guc-guard.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", ".git", "coverage", ".turbo"]);
const SCAN_EXTS = new Set([".sql", ".ts", ".mjs"]);

// ── 1. Discover files ───────────────────────────────────────────────────────
// Scoped to PRODUCTION code paths only: `services/*/migrations/**` (runs via
// the migration runner, and via any deploy/hotfix tooling against the real
// pooled connection) and `services/*/src/**` / `packages/*/src/**` (what
// actually serves live traffic through PgBouncer). Deliberately EXCLUDES
// `tests/`, `integration/`, and `scripts/seed/` — a first broad pass of this
// guard (scanning all of services/ + packages/) also found 33 pre-existing
// `set_config(..., false)` call sites across analytics-service,
// court-service, hrms-service (4 files beyond the one fixed alongside this
// guard), location-service, project-service and telephony-service, all in
// test/integration/seed-script code. Every one of those only ever runs
// against the direct Postgres port (5435) by the same operational
// convention noted for services/hrms-service/tests/fixtures/core-seed.ts
// (not through PgBouncer) — real, but a materially different risk profile
// from a production migration or src/ code path, and a 6-service, 33-site
// cleanup is out of scope for this fix-up round. Tracked as a fast-follow;
// see the PR description. This guard enforces the migrations/src/ subset
// strictly (zero violations, unconditionally) so that class of bug can
// never recur in the paths that actually serve pooled production traffic.
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(extname(entry.name))) out.push(join(dir, entry.name));
    }
  }
}

function discoverFiles() {
  const files = [];

  const servicesDir = join(REPO_ROOT, "services");
  if (existsSync(servicesDir) && statSync(servicesDir).isDirectory()) {
    for (const svc of readdirSync(servicesDir)) {
      const svcDir = join(servicesDir, svc);
      if (!statSync(svcDir).isDirectory()) continue;
      const migrationsDir = join(svcDir, "migrations");
      if (existsSync(migrationsDir) && statSync(migrationsDir).isDirectory()) walk(migrationsDir, files);
      const srcDir = join(svcDir, "src");
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) walk(srcDir, files);
    }
  }

  const packagesDir = join(REPO_ROOT, "packages");
  if (existsSync(packagesDir) && statSync(packagesDir).isDirectory()) {
    for (const pkg of readdirSync(packagesDir)) {
      const srcDir = join(packagesDir, pkg, "src");
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) walk(srcDir, files);
    }
  }

  return files.sort();
}

// ── 2. Comment stripping (best-effort) ──────────────────────────────────────
// `sqlStyle=true` treats `--` as a line comment (SQL); otherwise `//` (JS/TS).
// Both styles share `/* ... */` block comments. Line count is preserved so
// reported line numbers stay accurate.
function stripComments(source, sqlStyle) {
  const lineCommentToken = sqlStyle ? "--" : "//";
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    let result = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (two === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          inBlock = true;
          break;
        }
        result += " ".repeat(end + 2 - i);
        i = end + 2;
      } else if (two === lineCommentToken) {
        break;
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out;
}

// ── 3. Check 1: raw session-scoped tenant/app GUC ───────────────────────────
// Matches `SET app.foo = ...` / `SET SESSION app.foo = ...` but NOT
// `SET LOCAL app.foo = ...`. `(?!LOCAL\b)` after `SET\s+` rejects LOCAL right
// after SET; `SESSION` is accepted (still a violation — session-scoped).
const RAW_SET_RE = /\bSET\s+(?!LOCAL\b)(?:SESSION\s+)?((?:app|tenant)\.[A-Za-z_][A-Za-z0-9_]*)\s*=/gi;
// Matches `set_config('app.foo', <value>, true|false)` and captures the
// is_local boolean so only an explicit `false` is flagged. The middle
// (value) argument is matched as "anything but a paren" so the match can't
// stretch past this call's own closing `)` into a LATER, unrelated
// set_config(...) call further down the file — every real value argument in
// this codebase (a UUID string literal, a `${...}` template interpolation, a
// `:'bind_param'`, a bound `$1`) satisfies that; a value that itself calls a
// function would not match, which is fine — this guard is best-effort and
// erring toward under- rather than over-reporting.
const SET_CONFIG_RE = /\bset_config\s*\(\s*['"]((?:app|tenant)\.[A-Za-z_][A-Za-z0-9_]*)['"]\s*,\s*[^()]*?,\s*(true|false)\s*\)/gi;

export function checkTenantGucViolations(source, isSql) {
  const lines = stripComments(source, isSql);
  const violations = [];

  lines.forEach((line, idx) => {
    RAW_SET_RE.lastIndex = 0;
    let m;
    while ((m = RAW_SET_RE.exec(line)) !== null) {
      violations.push({
        line: idx + 1,
        snippet: line.trim(),
        reason: `raw session-scoped SET (${m[1]}) — use SET LOCAL, or set_config('${m[1]}', ..., true) inside a transaction`,
      });
    }
  });

  // set_config(...) can legitimately span multiple lines, so check against
  // the whole stripped source (not line-by-line) and locate the reported
  // line by the match's start offset. Only an explicit `false` is flagged;
  // `true` (or an unrecognized third arg, which this regex won't match at
  // all) is left alone.
  const stripped = lines.join("\n");
  SET_CONFIG_RE.lastIndex = 0;
  let sm;
  while ((sm = SET_CONFIG_RE.exec(stripped)) !== null) {
    if (sm[2].toLowerCase() !== "false") continue;
    const upToMatch = stripped.slice(0, sm.index);
    const lineNo = upToMatch.split("\n").length;
    violations.push({
      line: lineNo,
      snippet: lines[lineNo - 1]?.trim() ?? sm[0].trim(),
      reason: `set_config('${sm[1]}', ..., false) is session-scoped — pass true (SET LOCAL semantics) instead`,
    });
  }

  violations.sort((a, b) => a.line - b.line);
  return violations;
}

// ── 4. Check 2 (related, separate): non-xact advisory locks ────────────────
// Flags pg_advisory_lock / pg_try_advisory_lock / their _shared variants —
// but not the _xact_ (transaction-scoped) family, and not the _unlock_
// family (releasing is not the risky half).
const ADVISORY_LOCK_RE = /\bpg_(try_)?advisory_lock(_shared)?\s*\(/gi;

export function checkAdvisoryLockViolations(source, isSql) {
  const lines = stripComments(source, isSql);
  const violations = [];
  lines.forEach((line, idx) => {
    ADVISORY_LOCK_RE.lastIndex = 0;
    if (ADVISORY_LOCK_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim(),
        reason: "session-scoped advisory lock — prefer pg_advisory_xact_lock (auto-released at commit/rollback) unless session-scoping is genuinely required and justified in a comment",
      });
    }
  });
  return violations;
}

// ── 5. Run ───────────────────────────────────────────────────────────────────
function main() {
  const files = discoverFiles();
  const gucViolations = [];
  const lockViolations = [];

  for (const file of files) {
    const isSql = extname(file) === ".sql";
    const source = readFileSync(file, "utf8");
    for (const v of checkTenantGucViolations(source, isSql)) {
      gucViolations.push({ file, ...v });
    }
    for (const v of checkAdvisoryLockViolations(source, isSql)) {
      lockViolations.push({ file, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Raw Session GUC Guard — PgBouncer transaction-pool leak (PERF-001)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Files scanned (services/*/migrations, services/*/src, packages/*/src): ${files.length}`);
  console.log("");

  let exitCode = 0;

  if (gucViolations.length === 0) {
    console.log("  ✅ CLEAN — no raw session-scoped app.*/tenant.* GUC found.");
  } else {
    exitCode = 1;
    console.log(`  ❌ ${gucViolations.length} tenant/app GUC violation(s):`);
    console.log("");
    for (const v of gucViolations) {
      const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
      console.log(`  [RAW-SESSION-GUC] ${rel}:${v.line}`);
      console.log(`      ${v.reason}`);
      console.log(`      ${v.snippet}`);
    }
  }
  console.log("");

  if (lockViolations.length === 0) {
    console.log("  ✅ CLEAN — no session-scoped (non-xact) advisory lock found.");
  } else {
    exitCode = 1;
    console.log(`  ❌ ${lockViolations.length} advisory-lock violation(s):`);
    console.log("");
    for (const v of lockViolations) {
      const rel = relative(REPO_ROOT, v.file).split(sep).join("/");
      console.log(`  [SESSION-ADVISORY-LOCK] ${rel}:${v.line}`);
      console.log(`      ${v.reason}`);
      console.log(`      ${v.snippet}`);
    }
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(exitCode);
}

// Only run when executed directly (not when imported by callers/tests) —
// mirrors scripts/ci/tenant-router-guard.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
