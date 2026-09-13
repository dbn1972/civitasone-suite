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
// SEC-022 EXTENSION: a table can also gain its tenant_id column via a LATER
// `ALTER TABLE ... ADD COLUMN tenant_id`, against a table that already exists
// (CREATEd earlier — in this same migration file, or in an earlier one for
// the same service). The original check above only ever looked at a CREATE
// TABLE's own column list, so this shape was completely invisible: a table
// created without tenant_id, then ALTERed later to add it, was never flagged
// as needing RLS no matter how it ended up. Fixed by additionally scanning
// each file's `ALTER TABLE ... ADD COLUMN` statements for a real `tenant_id`
// addition (same whole-column-name rule as the CREATE TABLE check, so
// `ADD COLUMN parent_tenant_id` still doesn't count) against a table this
// guard has already seen CREATEd — tracked in a `knownTables` map threaded
// across one service's migration files in sorted (chronological) order by
// `main()` below; a bare `findTenantTableViolations(sqlText)` call (every
// existing unit test) gets a fresh, private map and is unaffected. The
// ALTER's own file is held to the identical same-file-RLS requirement as a
// CREATE-TABLE-time tenant_id. At the time of this fix, two real fleet
// migrations exercise this exact shape — admin-service's
// 0004b_missing_module_tables.sql / 0014_webhook_lifecycle.sql
// (webhooks.webhook_deliveries) and payroll-service's
// 0012_p1_challan_taxcfg_perq_26q.sql / 0039_tax_slab_config_tenant_scope.sql
// (payroll.tax_slab_config) — both already carry ENABLE + FORCE + CREATE
// POLICY in the same file as their ADD COLUMN, so both pass clean under the
// new check and the baseline needs no new entries for them. (This corrects
// this gap's original evidence, which read no such pattern anywhere in the
// fleet today — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md SEC-022 for the
// full correction; the underlying blind spot was real, it just hadn't yet
// been exercised by a live *vulnerability*, only by two already-careful
// migrations.)
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
//    and check whether THIS file also RLS-protects it. SEC-022: also find
//    every `ALTER TABLE ... ADD COLUMN tenant_id` against a table already
//    known to exist (this file's own CREATE TABLEs, or an earlier migration
//    file via the caller-threaded `knownTables`) and hold its own file to
//    the same same-file-RLS bar. Exported for unit testing (see
//    tests/architecture/tenant-table-rls-guard.test.ts). `knownTables` is an
//    optional Map(bare lowercase table name -> canonical name as first
//    seen); a bare call with no second argument (every existing unit test)
//    gets a fresh, private map, so behaviour for anything that doesn't
//    itself contain a cross-referencing ALTER is unchanged. ───────────────
export function findTenantTableViolations(sqlText, knownTables = new Map()) {
  const text = stripSqlComments(sqlText);
  const createTableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)"?\s*\(/gi;
  const violations = [];
  const flaggedTables = new Set(); // bare lowercase names already pushed as a violation in this call
  let match;

  const buildRef = (tableName, bare) =>
    tableName === bare ? escapeRe(bare) : `(?:${escapeRe(tableName)}|${escapeRe(bare)})`;

  // Same-file RLS check, shared by the CREATE TABLE and ALTER TABLE paths
  // below: does `text` carry ENABLE + FORCE + a CREATE POLICY for `ref`?
  const checkRls = (ref) => ({
    hasEnable: new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?${ref}\\s+ENABLE ROW LEVEL SECURITY`, "i").test(text),
    hasForce: new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?${ref}\\s+FORCE ROW LEVEL SECURITY`, "i").test(text),
    hasPolicy: new RegExp(`CREATE POLICY\\s+\\S+\\s+ON\\s+${ref}\\b`, "i").test(text),
  });

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

    const bare = tableName.includes(".") ? tableName.slice(tableName.indexOf(".") + 1) : tableName;
    const bareKey = bare.toLowerCase();
    // Register this table as known — for the ALTER scan below (this same
    // file) and, via the caller-threaded map, for any later migration file
    // — regardless of whether it has tenant_id yet, since a table without
    // one is exactly what the ALTER scan needs to recognize. First writer
    // (the actual CREATE TABLE) wins the canonical spelling.
    if (!knownTables.has(bareKey)) knownTables.set(bareKey, tableName);

    // Whole-column-name match: `tenant_id` must start a column definition
    // (right after `(` or a `,`), not merely appear as a suffix of another
    // column like `parent_tenant_id`.
    const hasTenantId = /(^|,)\s*"?tenant_id"?\s/m.test(body);
    if (!hasTenantId) continue;

    // The table may be referenced schema-qualified at creation but bare in
    // the ALTER/POLICY statements (or vice versa, if search_path resolves
    // it) — accept either spelling.
    const ref = buildRef(tableName, bare);
    const { hasEnable, hasForce, hasPolicy } = checkRls(ref);

    if (!(hasEnable && hasForce && hasPolicy)) {
      violations.push({
        table: tableName,
        missing: [
          !hasEnable && "ENABLE ROW LEVEL SECURITY",
          !hasForce && "FORCE ROW LEVEL SECURITY",
          !hasPolicy && "CREATE POLICY",
        ].filter(Boolean),
      });
      flaggedTables.add(bareKey);
    }
  }

  // ── SEC-022: `ALTER TABLE ... ADD COLUMN tenant_id` against a table
  //    already known to exist. Each ALTER TABLE statement's full clause list
  //    (up to its terminating `;`) is captured in one go so a multi-column
  //    `ADD COLUMN foo ..., ADD COLUMN tenant_id ...` on a single statement
  //    is still found regardless of which comma-separated clause it's in.
  //    `COLUMN` is optional, matching Postgres' own grammar. Same
  //    whole-column-name guard as above, so `ADD COLUMN parent_tenant_id`
  //    still doesn't count. ────────────────────────────────────────────────
  const alterTableRe = /ALTER TABLE\s+(?:ONLY\s+)?"?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)"?\s+([^;]*);/gi;
  const addsTenantIdRe = /ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?"?tenant_id"?(\s|,|$)/i;
  let alterMatch;

  while ((alterMatch = alterTableRe.exec(text)) !== null) {
    const tableName = alterMatch[1];
    const clause = alterMatch[2];
    if (!addsTenantIdRe.test(clause)) continue;

    const bare = tableName.includes(".") ? tableName.slice(tableName.indexOf(".") + 1) : tableName;
    const bareKey = bare.toLowerCase();
    if (!knownTables.has(bareKey)) continue; // not a table this guard has seen CREATEd anywhere
    if (flaggedTables.has(bareKey)) continue; // already flagged via the CREATE TABLE path above

    const canonical = knownTables.get(bareKey);
    const ref = buildRef(tableName, bare);
    const { hasEnable, hasForce, hasPolicy } = checkRls(ref);

    if (!(hasEnable && hasForce && hasPolicy)) {
      violations.push({
        table: canonical,
        missing: [
          !hasEnable && "ENABLE ROW LEVEL SECURITY",
          !hasForce && "FORCE ROW LEVEL SECURITY",
          !hasPolicy && "CREATE POLICY",
        ].filter(Boolean),
      });
      flaggedTables.add(bareKey);
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

  // SEC-022: a table can gain tenant_id via a later ALTER TABLE ... ADD
  // COLUMN rather than at CREATE TABLE time, possibly in a later migration
  // file than the one that created the table. Track known tables per
  // service, across that service's files in sorted (chronological, by this
  // fleet's zero-padded migration-number convention) order — each service
  // owns its own schema/tables, so cross-service table-name reuse (e.g. two
  // services both happening to have a `settings` table) must never be
  // conflated into one shared registry.
  let knownTables = new Map();
  let currentService = null;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const svc = rel.split("/")[1]; // services/<svc>/migrations/<file>.sql
    if (svc !== currentService) {
      currentService = svc;
      knownTables = new Map();
    }
    const source = readFileSync(file, "utf8");
    for (const v of findTenantTableViolations(source, knownTables)) {
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
