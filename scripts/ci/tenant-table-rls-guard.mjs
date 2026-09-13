#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tenant-table-rls-guard.mjs — SEC-010: a migration that CREATEs a tenant_id
// table must carry its RLS (ENABLE + FORCE + CREATE POLICY) in that SAME
// migration file.
//
// THE DEFECT THIS CATCHES
// ------------------------
// SEC-009/SEC-010 both trace to the same process gap: this fleet's history is
// "create the table now, add RLS in a later isolation-sweep migration" (see
// e.g. hrms-service 0026/0034, admin-service 0005/0006, workflow-service
// 0013/0018 — each a fleet-wide sweep bolted on well after the tables it
// covers were created). Sweeps are a point-in-time, best-effort pass: any
// table created after the last sweep — or simply missed by it — silently
// ships with no database-level tenant isolation until someone notices via
// audit (SEC-010 found 8 such tables across hrms/admin/workflow-service,
// live in production, some for months). This guard closes the window
// completely: a NEW migration is not reviewable as safe merely because
// "a sweep will catch it later" — it must be correct on arrival.
//
// CHECK: for every `CREATE TABLE` in a services/*/migrations/*.sql file whose
// column list includes a `tenant_id` column, does that SAME file also
// contain, for that same table, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
// `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, and a `CREATE POLICY ... ON
// <table>`? (ENABLE alone is not enough — see SEC-009: most of this fleet's
// per-service migration loop runs AS the owning service role, which ENABLE
// alone does not restrict; only FORCE does — scripts/ci/bootstrap-postgres.sh
// SERVICE_DBS loop.)
//
// RATCHET, NOT A RETROACTIVE GATE: fixing a table created without inline RLS
// always means writing a NEW, separate migration (you do not edit an
// already-applied migration file) — exactly what SEC-009 and SEC-010 do. That
// means even a fully-fixed table's ORIGINAL creating migration permanently
// reads as "CREATE TABLE with tenant_id, no RLS in this file" under a literal
// per-file check, and the fleet has a long history of this shape (every
// service's early "sweep" pattern above). Failing CI on that whole backlog
// would block every unrelated PR fleet-wide, so — exactly like
// tenant-index-guard.mjs and schema-drift-guard.mjs — known files are tracked
// in a baseline and do not fail the build; the gate is on NEW violations (a
// migration added after this guard existed) and on stale baseline entries
// (see below). This is the "create now, RLS later" ratchet is *closed*, not
// the backlog erased.
//
// Usage:
//   node scripts/ci/tenant-table-rls-guard.mjs                 # guard: exit 1 on
//                                                                # new/stale baseline entries
//   node scripts/ci/tenant-table-rls-guard.mjs --write-baseline # regenerate the baseline
//                                                                # from the current tree
//
// No live database needed — this is pure migration-text analysis, so (unlike
// tenant-index-guard.mjs / schema-drift-guard.mjs) it runs in the arch-guard
// job, not the Bootstrap Postgres job.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const BASELINE_FILE = join(__dirname, "tenant-table-rls-baseline.json");

const WRITE_BASELINE = process.argv.includes("--write-baseline");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. Strip SQL comments so prose mentioning "ROW LEVEL SECURITY" (every
//    migration in this fleet documents its RLS choices in comments) can never
//    masquerade as a real ALTER/POLICY statement, and a commented-out CREATE
//    TABLE can never masquerade as a real table. ─────────────────────────────
function stripSqlComments(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── 2. Find every CREATE TABLE whose column list has a `tenant_id` column,
//    and check whether THIS file also RLS-protects it. Exported for unit
//    testing (see tests/architecture/tenant-table-rls-guard.test.ts). ───────
export function findTenantTableViolations(sqlText) {
  const text = stripSqlComments(sqlText);
  const createTableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)"?\s*\(/gi;
  const violations = [];
  let match;

  while ((match = createTableRe.exec(text)) !== null) {
    const tableName = match[1];
    // Walk paren depth from just after the opening `(` to find the matching
    // close — a naive non-greedy regex would stop at the first `)`, which
    // truncates at the first `varchar(64)` / `CHECK (...)` inside the column
    // list.
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    const body = text.slice(match.index + match[0].length, i - 1);

    // Whole-column-name match: `tenant_id` must start a column definition
    // (right after `(` or a `,`), not merely appear as a suffix of another
    // column like `parent_tenant_id`.
    const hasTenantId = /(^|,)\s*"?tenant_id"?\s/m.test(body);
    if (!hasTenantId) continue;

    // The table may be referenced schema-qualified at creation but bare in
    // the ALTER/POLICY statements (or vice versa, if search_path resolves
    // it) — accept either spelling.
    const bare = tableName.includes(".") ? tableName.slice(tableName.indexOf(".") + 1) : tableName;
    const ref = tableName === bare ? escapeRe(bare) : `(?:${escapeRe(tableName)}|${escapeRe(bare)})`;

    const hasEnable = new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?${ref}\\s+ENABLE ROW LEVEL SECURITY`, "i").test(text);
    const hasForce = new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?${ref}\\s+FORCE ROW LEVEL SECURITY`, "i").test(text);
    const hasPolicy = new RegExp(`CREATE POLICY\\s+\\S+\\s+ON\\s+${ref}\\b`, "i").test(text);

    if (!(hasEnable && hasForce && hasPolicy)) {
      violations.push({
        table: tableName,
        missing: [
          !hasEnable && "ENABLE ROW LEVEL SECURITY",
          !hasForce && "FORCE ROW LEVEL SECURITY",
          !hasPolicy && "CREATE POLICY",
        ].filter(Boolean),
      });
    }
  }
  return violations;
}

// ── 3. File discovery: services/*/migrations/*.sql, top level only (mirrors
//    bootstrap-postgres.sh's `find "$mig_dir" -maxdepth 1 -name '*.sql'`). ──
function discoverMigrationFiles() {
  if (!existsSync(SERVICES_DIR)) return [];
  const files = [];
  for (const svc of readdirSync(SERVICES_DIR)) {
    const migDir = join(SERVICES_DIR, svc, "migrations");
    if (!existsSync(migDir) || !statSync(migDir).isDirectory()) continue;
    for (const f of readdirSync(migDir)) {
      if (f.endsWith(".sql")) files.push(join(migDir, f));
    }
  }
  return files.sort();
}

// ── 4. Run ──────────────────────────────────────────────────────────────────
function main() {
  const files = discoverMigrationFiles();
  const allViolations = []; // { key, file, table, missing }

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const source = readFileSync(file, "utf8");
    for (const v of findTenantTableViolations(source)) {
      allViolations.push({ key: `${rel}::${v.table}`, file: rel, ...v });
    }
  }

  console.log(`${BOLD}tenant-table-rls-guard${RESET}: scanned ${files.length} migration file(s) fleet-wide`);

  if (WRITE_BASELINE) {
    const entries = allViolations.map((v) => v.key).sort();
    const baseline = {
      $comment:
        "TRACKED DEBT, not an approved state. Each entry is a migration file that CREATEs a table with a tenant_id column but does not ENABLE + FORCE row-level security and CREATE a policy for it IN THE SAME FILE -- almost always because this fleet's convention has historically been 'create the table now, RLS it in a later isolation-sweep migration' (see e.g. hrms-service 0026/0034, admin-service 0005/0006, workflow-service 0013/0018). Fixing one of these tables always means a NEW migration (you do not edit an already-applied file), so a genuinely-fixed table's original CREATE TABLE migration stays in this list forever -- that is expected, not a bug in this guard. The gate is on NEW entries (a migration added after this guard existed) and on STALE entries (a listed file that was edited and no longer reproduces -- extremely rare, since migrations aren't normally edited after being applied, but possible pre-merge). See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-009/SEC-010. Regenerate with --write-baseline only after confirming any newly-absent entries are a real, reviewed fix, not an accidental file deletion/rename.",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries,
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`${GREEN}Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_FILE)}${RESET}`);
    process.exit(0);
  }

  let baselineEntries = new Set();
  if (existsSync(BASELINE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
      baselineEntries = new Set(parsed.entries ?? []);
    } catch (e) {
      console.error(`${RED}Could not parse ${relative(REPO_ROOT, BASELINE_FILE)}: ${e.message}${RESET}`);
      process.exit(1);
    }
  }

  const currentKeys = new Set(allViolations.map((v) => v.key));
  const newViolations = allViolations.filter((v) => !baselineEntries.has(v.key));
  const staleEntries = [...baselineEntries].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineEntries.has(v.key));

  if (allViolations.length === 0) {
    console.log(`${GREEN}PASS${RESET} — no tenant_id table anywhere lacks same-file RLS.`);
  } else {
    console.log(`${allViolations.length} tenant_id table(s) without same-file RLS (${knownDebt.length} tracked in baseline, ${newViolations.length} new):`);
    for (const v of allViolations) {
      const isNew = !baselineEntries.has(v.key);
      console.log(`  ${isNew ? RED : YELLOW}${v.file} -- ${v.table}${isNew ? "  <-- NEW, not in baseline" : "  (baselined debt)"}${RESET}`);
      if (isNew) console.log(`      ${DIM}missing: ${v.missing.join(", ")}${RESET}`);
    }
  }

  let failed = false;
  if (newViolations.length > 0) {
    console.log(`${RED}FAIL${RESET} — ${newViolations.length} new migration(s) create a tenant_id table without RLS in the same file. Add ENABLE + FORCE ROW LEVEL SECURITY and a CREATE POLICY for it in this same migration (see services/hrms-service/migrations/0135_audit_hr_action_log.sql for the current house pattern), or if this is genuinely tracked debt being ported in, run --write-baseline.`);
    failed = true;
  }
  if (staleEntries.length > 0) {
    console.log(`${RED}FAIL${RESET} — ${staleEntries.length} baseline entr${staleEntries.length === 1 ? "y no longer reproduces" : "ies no longer reproduce"} — regenerate with --write-baseline so a real fix can't be silently reverted for free:`);
    for (const k of staleEntries) console.log(`  ${GREEN}${k}${RESET}  (no longer a violation, remove from baseline)`);
    failed = true;
  }
  if (!failed) {
    console.log(`${GREEN}PASS${RESET} — no new violations, baseline is accurate (${knownDebt.length} tracked legacy entries remain).`);
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
