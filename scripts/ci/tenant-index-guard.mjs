#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tenant-index-guard.mjs — every RLS'd tenant table must have an index whose
// LEADING column is tenant_id (PERF-002).
//
// THE DEFECT THIS CATCHES
// ------------------------
// A table with a tenant_id column and row-level security enabled relies on
// Postgres evaluating `tenant_id = current_setting('app.tenant_id')` for every
// row on every query. Without an index whose first key column is tenant_id,
// that predicate forces a sequential scan under RLS regardless of any other
// WHERE clause, on every tenant-scoped query the fleet issues. PERF-002 found
// 271 such tables fleet-wide, measured against migration text (skill 21 could
// not start a live host during its audit); this guard measures the LIVE
// cluster instead, which is more expensive but cannot lie the way the audit's
// migration-text read could (an index dropped or renamed after its creating
// migration wouldn't show up in a grep of migrations/).
//
// CHECK: for every table with a `tenant_id` column and `relrowsecurity = true`,
// does at least one index exist with tenant_id as indkey[0] (the leading key)?
// A tenant_id column that is ALSO the sole primary key (PK-only tables like
// `work_proposals` was before this PR's migration) still counts as indexed —
// the PK index's leading column is what's checked, not whether the index is
// "for" tenant_id.
//
// RATCHET, NOT A FULL GATE (yet): PERF-002's first tranche fixed 11 of the
// fleet's 263 currently-measured violations (see docs/ENTERPRISE-GAP-REPORT
// PERF-002 and its follow-up PERF-015 for the remainder). Failing CI on the
// whole backlog immediately would block every unrelated PR fleet-wide, so —
// exactly like scripts/ci/schema-drift-guard.mjs — known violations are
// tracked in a baseline file and do not fail the build; the gate is on NEW
// violations (a newly created RLS tenant table with no tenant_id index) and
// on baselined entries that were fixed but left listed (so a real fix can't
// be silently reverted for free). Regenerate the baseline only after a real
// fix, on a freshly bootstrapped cluster.
//
// Usage:
//   node scripts/ci/tenant-index-guard.mjs                # guard: exit 1 on
//                                                           # new/stale baseline entries
//   node scripts/ci/tenant-index-guard.mjs --report        # also print composite-index
//                                                           # coverage stats (informational,
//                                                           # does not affect exit code)
//   node scripts/ci/tenant-index-guard.mjs --write-baseline # regenerate the baseline from
//                                                           # the current live cluster
//   node scripts/ci/tenant-index-guard.mjs <service>        # limit to one service
//
// Env: PGHOST (default localhost), PGPORT (default 5435), POSTGRES_ADMIN_USER
// (default civitas_admin), POSTGRES_ADMIN_PASSWORD (default civitas_dev_pw).
//
// A database that cannot be reached is SKIPPED and named in the output — never
// silently treated as clean, and --write-baseline refuses to run when
// anything was skipped (mirrors schema-drift-guard.mjs). Measure on a freshly
// bootstrapped cluster (scripts/ci/bootstrap-postgres.sh) for a number that
// matches what CI sees.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const BASELINE_FILE = join(REPO_ROOT, "scripts/ci/tenant-index-baseline.json");
const PGHOST = process.env.PGHOST ?? "localhost";
const PGPORT = process.env.PGPORT ?? "5435";
const ADMIN_USER = process.env.POSTGRES_ADMIN_USER ?? "civitas_admin";
const ADMIN_PW = process.env.POSTGRES_ADMIN_PASSWORD ?? "civitas_dev_pw";

const REPORT = process.argv.includes("--report");
const WRITE_BASELINE = process.argv.includes("--write-baseline");
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function psql(db, sql) {
  try {
    return execFileSync(
      "psql",
      ["-h", PGHOST, "-p", PGPORT, "-U", ADMIN_USER, "-d", db, "-t", "-A", "-F", "\t", "-c", sql],
      { encoding: "utf8", timeout: 20000, env: { ...process.env, PGPASSWORD: ADMIN_PW } },
    );
  } catch {
    return null;
  }
}

// One query does the whole job per database: for every RLS'd table that has a
// tenant_id column, report whether a leading-tenant_id index exists, whether a
// (tenant_id, status) composite exists, and whether a (tenant_id, created_at)
// composite exists. Also count *_id columns lacking a leading-column index, for
// the descriptive stats (informational — not part of the pass/fail guard).
const MAIN_QUERY = `
WITH tenant_tables AS (
  SELECT t.oid AS reloid, n.nspname AS schema_name, t.relname AS table_name,
         a.attnum AS tenant_attnum, t.relrowsecurity AS rls_on
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
  WHERE t.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog','information_schema')
),
status_col AS (
  SELECT attrelid, attnum FROM pg_attribute WHERE attname = 'status' AND attnum > 0 AND NOT attisdropped
),
created_col AS (
  SELECT attrelid, attnum FROM pg_attribute WHERE attname = 'created_at' AND attnum > 0 AND NOT attisdropped
)
SELECT
  tt.schema_name || '.' || tt.table_name AS table_name,
  tt.rls_on::text,
  EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indrelid = tt.reloid AND i.indkey[0] = tt.tenant_attnum
  )::text AS has_tenant_index,
  EXISTS (
    SELECT 1 FROM pg_index i JOIN status_col sc ON sc.attrelid = tt.reloid
    WHERE i.indrelid = tt.reloid AND i.indkey[0] = tt.tenant_attnum AND i.indkey[1] = sc.attnum
  )::text AS has_tenant_status_composite,
  EXISTS (
    SELECT 1 FROM pg_index i JOIN created_col cc ON cc.attrelid = tt.reloid
    WHERE i.indrelid = tt.reloid AND i.indkey[0] = tt.tenant_attnum AND i.indkey[1] = cc.attnum
  )::text AS has_tenant_created_composite,
  (SELECT count(*)::text FROM pg_attribute a2
     WHERE a2.attrelid = tt.reloid AND a2.attnum > 0 AND NOT a2.attisdropped
       AND a2.attname LIKE '%\\_id' ESCAPE '\\'
       AND NOT EXISTS (SELECT 1 FROM pg_index i2 WHERE i2.indrelid = tt.reloid AND i2.indkey[0] = a2.attnum)
  ) AS unindexed_id_cols,
  (SELECT count(*)::text FROM pg_attribute a3 WHERE a3.attrelid = tt.reloid AND a3.attnum > 0 AND NOT a3.attisdropped) AS col_count
FROM tenant_tables tt
ORDER BY 1;
`;

// Database name is `civitas_<svc>` with one exception: ai-agent-service's
// role/DB predate this convention and use an underscore (civitas_ai_agent,
// see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map) rather than the
// hyphen every other multi-word service name would produce. It is the only
// hyphenated service directory in the fleet (ls services | grep -E
// '^[a-z]+-[a-z]+-service$' — checked 2026-09-08), so a single override
// covers it rather than parsing bootstrap-postgres.sh's bash map at runtime.
const DB_NAME_OVERRIDES = { "ai-agent": "civitas_ai_agent" };
function dbNameFor(svc) {
  return DB_NAME_OVERRIDES[svc] ?? `civitas_${svc}`;
}

const services = readdirSync(SERVICES_DIR)
  .filter((d) => d.endsWith("-service"))
  .map((d) => d.replace("-service", ""))
  .filter((s) => (only ? s === only : true))
  .filter((s) => existsSync(join(SERVICES_DIR, `${s}-service`, "migrations")))
  .sort();

const violations = []; // tables with RLS on, tenant_id present, no leading index
const skipped = [];
const rows = []; // full rows, for --report
let checkedServices = 0;
const queriedServices = new Set(); // services actually reachable+queried this run
let checkedTables = 0;

for (const svc of services) {
  const db = dbNameFor(svc);
  const out = psql(db, MAIN_QUERY);
  if (out === null) {
    skipped.push(`${svc} (${db} unreachable)`);
    continue;
  }
  checkedServices += 1;
  queriedServices.add(svc);
  const lines = out.split("\n").filter(Boolean);
  for (const line of lines) {
    const [table, rlsOn, hasTenantIdx, hasStatusComp, hasCreatedComp, unindexedIdCols, colCount] =
      line.split("\t");
    checkedTables += 1;
    const row = {
      svc,
      table,
      key: `${svc}.${table}`,
      rlsOn: rlsOn === "t" || rlsOn === "true",
      hasTenantIdx: hasTenantIdx === "t" || hasTenantIdx === "true",
      hasStatusComp: hasStatusComp === "t" || hasStatusComp === "true",
      hasCreatedComp: hasCreatedComp === "t" || hasCreatedComp === "true",
      unindexedIdCols: Number(unindexedIdCols),
      colCount: Number(colCount),
    };
    rows.push(row);
    if (row.rlsOn && !row.hasTenantIdx) {
      violations.push(row);
    }
  }
}

console.log(`${BOLD}tenant-index-guard${RESET}: checked ${checkedServices} service DB(s), ${checkedTables} tenant_id-bearing table(s)`);
if (skipped.length > 0) {
  console.log(`${YELLOW}Skipped (unreachable):${RESET} ${skipped.join(", ")}`);
}

if (WRITE_BASELINE) {
  // Each skip must be explicitly named via --allow-skip=svc1,svc2 — this is
  // NOT a blanket bypass, it forces the skip to be a conscious, visible
  // decision recorded in the baseline's own $comment rather than a silent
  // gap. As of 2026-09-08 the only known case is field-service: it has real
  // migrations (services/field-service/migrations/) but is not wired into
  // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map at all (unlike e.g.
  // ai-agent-service, which IS wired, just under civitas_ai_agent instead of
  // the civitas_ai-agent this script would otherwise guess — see
  // DB_NAME_OVERRIDES above), so no fresh cluster including CI's ever has a
  // civitas_field database to check. That is a bootstrap-config gap outside
  // PERF-002's scope (tenant indexing), flagged separately rather than fixed
  // here or silently swept into "clean."
  const allowSkipArg = process.argv.find((a) => a.startsWith("--allow-skip="));
  const allowSkip = new Set((allowSkipArg?.slice("--allow-skip=".length) ?? "").split(",").filter(Boolean));
  const unexpectedSkips = skipped.filter((s) => ![...allowSkip].some((a) => s.startsWith(a)));
  if (unexpectedSkips.length > 0) {
    console.error(`${RED}Refusing to write baseline: ${unexpectedSkips.length} database(s) were unreachable and not covered by --allow-skip:${RESET}`);
    for (const s of unexpectedSkips) console.error(`  ${s}`);
    console.error(`A baseline written with databases missing would under-report violations for those services.`);
    process.exit(1);
  }
  const entries = violations.map((v) => v.key).sort();
  const baseline = {
    $comment:
      "TRACKED DEBT, not an approved state. Each entry is an RLS tenant table with no index whose leading column is tenant_id, so it forces a sequential scan under RLS on every tenant-scoped query. The gate fails on NEW violations and on stale entries (fixed but left listed). Burn these down; regenerate with --write-baseline after a real fix, on a freshly bootstrapped cluster. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md PERF-002 (first tranche) and its follow-up PERF-015 (remainder).",
    generatedAt: new Date().toISOString().slice(0, 10),
    knownGaps: allowSkip.size > 0
      ? `Generated with --allow-skip=${[...allowSkip].join(",")}: ${[...allowSkip].join(", ")} database(s) do not exist on any cluster bootstrap-postgres.sh provisions (a bootstrap-config gap, not tenant-indexing debt — tracked separately, not in this file) and could not be checked. If that changes, regenerate without --allow-skip.`
      : undefined,
    count: entries.length,
    entries,
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`${GREEN}Wrote ${entries.length} entries to ${BASELINE_FILE}${RESET}`);
  process.exit(0);
}

// ── Ratchet against the baseline ────────────────────────────────────────────
let baselineEntries = new Set();
if (existsSync(BASELINE_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    baselineEntries = new Set(parsed.entries ?? []);
  } catch (e) {
    console.error(`${RED}Could not parse ${BASELINE_FILE}: ${e.message}${RESET}`);
    process.exit(1);
  }
}

const currentKeys = new Set(violations.map((v) => v.key));
const newViolations = violations.filter((v) => !baselineEntries.has(v.key));
// A baseline entry can only be "stale" (fixed but still listed) if this run
// actually queried its service — with --allow-skip or a positional <service>
// filter (or just a service that happens to be unreachable this run),
// entries for services never queried are neither confirmed fixed nor
// confirmed still-broken, so they must not be reported either way.
const staleEntries = [...baselineEntries]
  .filter((k) => queriedServices.has(k.split(".")[0]))
  .filter((k) => !currentKeys.has(k))
  .sort();
const knownDebt = violations.filter((v) => baselineEntries.has(v.key));

if (violations.length === 0) {
  console.log(`${GREEN}PASS${RESET} — every RLS'd tenant table has a leading tenant_id index.`);
} else {
  console.log(`${violations.length} RLS'd tenant table(s) with no leading tenant_id index (${knownDebt.length} tracked in baseline, ${newViolations.length} new):`);
  for (const v of violations) {
    const isNew = !baselineEntries.has(v.key);
    console.log(`  ${isNew ? RED : YELLOW}${v.svc}.${v.table}${isNew ? "  <-- NEW, not in baseline" : "  (baselined debt)"}${RESET}`);
  }
}

let failed = false;
if (newViolations.length > 0) {
  console.log(`${RED}FAIL${RESET} — ${newViolations.length} new tenant table(s) with no leading tenant_id index. Add the index in the same PR (CREATE INDEX CONCURRENTLY), or if this is intentional tracked debt, run --write-baseline.`);
  failed = true;
}
if (staleEntries.length > 0) {
  console.log(`${RED}FAIL${RESET} — ${staleEntries.length} baseline entr${staleEntries.length === 1 ? "y is" : "ies are"} fixed but still listed in ${BASELINE_FILE} — regenerate it with --write-baseline so the fix can't be silently reverted for free:`);
  for (const k of staleEntries) console.log(`  ${GREEN}${k}${RESET}  (fixed, remove from baseline)`);
  failed = true;
}
if (!failed) {
  console.log(`${GREEN}PASS${RESET} — no new violations, baseline is accurate (${knownDebt.length} tracked debt entries remain — see PERF-015).`);
}

if (REPORT) {
  const rlsTables = rows.filter((r) => r.rlsOn);
  const noStatusComp = rlsTables.filter((r) => !r.hasStatusComp);
  const totalUnindexedId = rows.reduce((s, r) => s + r.unindexedIdCols, 0);
  console.log(`\n${BOLD}--- descriptive report (informational, not part of pass/fail) ---${RESET}`);
  console.log(`RLS tenant tables total: ${rlsTables.length}`);
  console.log(`  missing leading tenant_id index: ${violations.length}`);
  console.log(`  missing (tenant_id, status) composite: ${noStatusComp.length}`);
  console.log(`  unindexed *_id columns (fleet-wide, all tenant_id-bearing tables): ${totalUnindexedId}`);
  console.log(`\nBy service (RLS tables / missing tenant idx / missing status composite):`);
  const bySvc = {};
  for (const r of rlsTables) {
    bySvc[r.svc] ??= { total: 0, missingIdx: 0, missingComp: 0 };
    bySvc[r.svc].total += 1;
    if (!r.hasTenantIdx) bySvc[r.svc].missingIdx += 1;
    if (!r.hasStatusComp) bySvc[r.svc].missingComp += 1;
  }
  for (const [svc, s] of Object.entries(bySvc).sort()) {
    console.log(`  ${svc}: ${s.total} / ${s.missingIdx} / ${s.missingComp}`);
  }
  console.log(`\nWidest by column count (top 15), tenant_id-bearing:`);
  for (const r of [...rows].sort((a, b) => b.colCount - a.colCount).slice(0, 15)) {
    console.log(`  ${r.svc}.${r.table}: ${r.colCount} cols, created_at composite=${r.hasCreatedComp}`);
  }
}

process.exit(failed ? 1 : 0);
