#!/usr/bin/env node
/**
 * schema-drift-guard.mjs — every column a Drizzle model declares must exist in
 * the live database.
 *
 * THE DEFECT THIS CATCHES
 * ----------------------
 * inspection-service `findings/schema.ts` declared
 *     verificationEvidence: jsonb("verification_evidence")
 * and its consumer wrote to it, but no migration ever created the column. Any
 * SELECT built from the model failed at runtime:
 *     PostgresError: column "verification_evidence" does not exist
 * GET /api/v1/inspection/findings returned 500.
 *
 * Nothing else in the programme sees this class:
 *   - `tsc` type-checks the model against itself, never against the database.
 *   - Unit tests mock or never touch the affected query.
 *   - The L3 lane checks column TYPES (money is bigint, timestamps are tz) on
 *     columns that EXIST — it cannot notice one that is absent.
 *   - Coverage is blind to it: the file can be 100% covered and still drift.
 * It stayed latent for inspection-service because the service had never run —
 * no role, no database, so nothing ever executed the query.
 *
 * Direction of the check: DECLARED -> DB. A column present in the database but
 * not in the model is reported as INFO, not a failure: that is normal during an
 * additive migration rollout (add column, deploy, then use it).
 *
 * Usage:
 *   node scripts/ci/schema-drift-guard.mjs               # all reachable DBs
 *   node scripts/ci/schema-drift-guard.mjs inspection    # one service
 * Exit: 0 clean or DB unreachable, 1 on any declared-but-missing column.
 *
 * A database that cannot be reached is SKIPPED and named in the output — never
 * silently treated as clean.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const PGHOST = process.env.PGHOST ?? "localhost";
const PGPORT = process.env.PGPORT ?? "5435";
const ADMIN_USER = process.env.POSTGRES_ADMIN_USER ?? "civitas_admin";
const ADMIN_PW = process.env.POSTGRES_ADMIN_PASSWORD ?? "civitas_dev_pw";

const only = process.argv[2] && process.argv[2].startsWith("--") === false
  ? process.argv[2]
  : undefined;

/**
 * The baseline is measured against a FRESH cluster bootstrapped from
 * scripts/ci/bootstrap-postgres.sh, because that is the only reproducible,
 * version-controlled state and it is what CI gates on.
 *
 * A long-lived developer cluster legitimately holds objects a fresh one lacks —
 * schemas and tables created by hand over time, outside version control. Measured
 * 2026-07-27: the dev cluster has 22 columns that a freshly bootstrapped cluster
 * does not, so it reports them as `stale`.
 *
 * `--allow-stale` downgrades stale entries to INFO for that case. It does NOT
 * relax the check that matters: NEW drift still fails. CI must run WITHOUT this
 * flag, so a genuinely fixed-but-still-listed entry is caught there.
 */
const ALLOW_STALE = process.argv.includes("--allow-stale");

/**
 * Columns a model may declare that are intentionally absent from the database —
 * e.g. a computed/virtual field. Each needs a written reason.
 * Format: "<service>.<schema>.<table>.<column>": "reason"
 */
const ALLOWED_MISSING = {};

/**
 * RATCHET BASELINE — tracked debt, NOT an approved state.
 *
 * The first fleet-wide run found 337 declared-but-missing columns across 13
 * services. Fixing them is a real migration effort (each column needs a type
 * decision, and several touch money/PII services), so they are recorded here and
 * the gate fails only on NEW drift.
 *
 * This does NOT assert the baselined columns are acceptable — every one of them
 * makes a SELECT built from its model fail at runtime. They must be burned down.
 *
 * The gate also fails if a baselined entry is FIXED but left in the file, so a
 * regression cannot be reintroduced for free.
 *
 * MEASURE IT ON A FRESH CLUSTER. A developer host understates drift, because
 * schemas and tables created there by hand mask exactly the defects this catches.
 * Regenerate only after a real fix:
 *   docker run -d --name pgprobe -e POSTGRES_USER=civitas -e POSTGRES_PASSWORD=civitas_test \
 *     -e POSTGRES_DB=civitas_test -p 5499:5432 postgres:16-alpine
 *   PGHOST=localhost PGPORT=5499 PGUSER=civitas PGPASSWORD=civitas_test \
 *     PGDATABASE=civitas_test POSTGRES_ADMIN_PASSWORD=civitas_test \
 *     bash scripts/ci/bootstrap-postgres.sh
 *   PGHOST=localhost PGPORT=5499 POSTGRES_ADMIN_USER=civitas \
 *     POSTGRES_ADMIN_PASSWORD=civitas_test \
 *     node scripts/ci/schema-drift-guard.mjs --write-baseline
 */
const BASELINE_FILE = join(REPO_ROOT, "scripts/ci/schema-drift-baseline.json");
const WRITE_BASELINE = process.argv.includes("--write-baseline");

function psql(db, sql) {
  try {
    return execFileSync(
      "psql",
      ["-h", PGHOST, "-p", PGPORT, "-U", ADMIN_USER, "-d", db, "-t", "-A", "-F", "\t", "-c", sql],
      { encoding: "utf8", timeout: 15000, env: { ...process.env, PGPASSWORD: ADMIN_PW } },
    );
  } catch {
    return null;
  }
}

/**
 * Extract (pgSchema, table, column) triples from a Drizzle schema file.
 *
 * Parsed with regex rather than the TS compiler because these files follow one
 * rigid shape: `pgSchema("x")`, then `.table("y", { col: type("db_col") })`.
 * Only columns given an explicit DB name are checked — an implicit-name column
 * cannot be resolved without evaluating the module, and skipping it under-reports
 * rather than producing a false failure.
 */
function parseSchemaFile(src) {
  const out = [];
  // pgSchema("name") assigned to a const -> map identifier to schema name.
  const schemaByIdent = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*pgSchema\(\s*["']([^"']+)["']\s*\)/g)) {
    schemaByIdent[m[1]] = m[2];
  }
  if (Object.keys(schemaByIdent).length === 0) return out;

  // <schemaIdent>.table("table_name", { ... })
  const tableRe = /(\w+)\.table\(\s*["']([^"']+)["']\s*,\s*\{/g;
  let t;
  while ((t = tableRe.exec(src)) !== null) {
    const schemaName = schemaByIdent[t[1]];
    if (!schemaName) continue;
    const tableName = t[2];

    // Walk braces from the opening `{` to find the column-definition block.
    let depth = 1;
    let i = tableRe.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    const body = src.slice(tableRe.lastIndex, i - 1);

    // key: someType("db_column_name"  — captures the explicit DB name.
    for (const c of body.matchAll(/(\w+)\s*:\s*\w+\(\s*["']([^"']+)["']/g)) {
      const dbCol = c[2];
      // Skip nested helpers like primaryKey({ columns: [...] }) which have no name arg
      if (/^[a-z_][a-z0-9_]*$/i.test(dbCol) === false) continue;
      out.push({ schema: schemaName, table: tableName, column: dbCol });
    }
  }
  return out;
}

function schemaFilesFor(svc) {
  const modDir = join(SERVICES_DIR, `${svc}-service`, "src", "modules");
  if (existsSync(modDir) === false) return [];
  const files = [];
  for (const m of readdirSync(modDir)) {
    const f = join(modDir, m, "schema.ts");
    if (existsSync(f)) files.push(f);
  }
  return files;
}

const services = readdirSync(SERVICES_DIR)
  .filter((d) => d.endsWith("-service"))
  .map((d) => d.replace("-service", ""))
  .filter((s) => (only ? s === only : true))
  .sort();

const missing = [];
const skipped = [];
let declaredCount = 0;
let checkedServices = 0;

for (const svc of services) {
  const files = schemaFilesFor(svc);
  if (files.length === 0) continue;

  const db = `civitas_${svc}`;
  const live = psql(
    db,
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  );
  if (live === null) {
    skipped.push(`${svc} (${db} unreachable)`);
    continue;
  }
  checkedServices += 1;

  const present = new Set(
    live.split("\n").filter(Boolean).map((r) => r.trim().split("\t").join(".")),
  );

  for (const f of files) {
    for (const d of parseSchemaFile(readFileSync(f, "utf8"))) {
      declaredCount += 1;
      const key = `${d.schema}.${d.table}.${d.column}`;
      if (present.has(key)) continue;
      if (ALLOWED_MISSING[`${svc}.${key}`]) continue;
      missing.push({ svc, key, file: f.slice(REPO_ROOT.length + 1) });
    }
  }
}

console.log("──────────────────────────────────────────────────────────────");
console.log("  Schema Drift Guard — declared columns must exist in the DB");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  services checked   : ${checkedServices}`);
console.log(`  columns declared   : ${declaredCount}`);
if (skipped.length > 0) {
  console.log(`  SKIPPED (unreachable, NOT verified): ${skipped.length}`);
  for (const s of skipped) console.log(`      ${s}`);
}
console.log("");

// A run that verified nothing must not report success.
if (checkedServices === 0 || declaredCount === 0) {
  console.error(
    "  UNMEASURED — no service was checked (no reachable database, or the\n" +
      "  schema parser matched nothing). This is not a pass.",
  );
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

const found = new Set(missing.map((m) => `${m.svc}.${m.key}`));

// ── Baseline write mode ──────────────────────────────────────────────────────
if (WRITE_BASELINE) {
  if (skipped.length > 0) {
    console.error(
      `  REFUSING to write a baseline: ${skipped.length} database(s) were unreachable,\n` +
        `  so their drift is unknown and would be silently recorded as zero.\n` +
        `  Bring them up first: ${skipped.join(", ")}`,
    );
    process.exit(1);
  }
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        $comment:
          "TRACKED DEBT, not an approved state. Each entry is a column a Drizzle " +
          "model declares that its database lacks, so any SELECT built from that " +
          "model fails at runtime. The gate fails on NEW drift and on stale " +
          "entries. Burn these down; regenerate with --write-baseline.",
        generatedAt: new Date().toISOString().slice(0, 10),
        count: found.size,
        entries: [...found].sort(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  baseline written: ${found.size} entries -> ${BASELINE_FILE.slice(REPO_ROOT.length + 1)}`);
  process.exit(0);
}

// ── Ratchet comparison ───────────────────────────────────────────────────────
let baseline = { entries: [] };
if (existsSync(BASELINE_FILE)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch (e) {
    console.error(`  FAILED: baseline is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  // Guard against a malformed baseline reading as "no known drift", which is the
  // unreachable-failure-condition bug class this programme exists to prevent.
  if (Array.isArray(baseline.entries) === false) {
    console.error("  FAILED: baseline is malformed — `entries` must be an array.");
    process.exit(1);
  }
}
const known = new Set(baseline.entries);

// Only compare services that were actually checked; a skipped service must not
// have its baselined entries reported as "fixed".
const checkedSvcs = new Set(services.filter((s) => skipped.some((k) => k.startsWith(`${s} `)) === false));

const novel = [...found].filter((k) => known.has(k) === false);
const stale = [...known].filter(
  (k) => checkedSvcs.has(k.split(".")[0]) && found.has(k) === false,
);

if (missing.length === 0 && known.size === 0) {
  console.log("  CLEAN — every declared column exists in its database.");
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(0);
}

console.log(`  drift found : ${found.size}`);
console.log(`  baselined   : ${known.size} (tracked debt — must be burned down)`);
console.log(`  NEW         : ${novel.length}`);
console.log(`  stale       : ${stale.length}`);
console.log("");

if (novel.length > 0) {
  console.log(`  ${novel.length} NEW declared column(s) missing from the database:`);
  for (const k of novel) {
    const m = missing.find((x) => `${x.svc}.${x.key}` === k);
    console.log(`      ${k}`);
    if (m) console.log(`          declared in ${m.file}`);
  }
  console.log("");
  console.log("  A column a Drizzle model declares but the database lacks makes");
  console.log("  every SELECT built from that model fail at runtime with");
  console.log('  \'column "x" does not exist\' — a 500, not a test failure.');
  console.log("  Add an additive migration, or record an exemption with a reason.");
}

if (stale.length > 0) {
  if (ALLOW_STALE) {
    console.log(
      `  INFO: ${stale.length} baselined entr(ies) are absent from this cluster's drift.\n` +
        "  --allow-stale was passed, so this is not a failure. Expected on a\n" +
        "  hand-provisioned developer cluster, which holds objects a freshly\n" +
        "  bootstrapped one does not. CI runs WITHOUT this flag.",
    );
  } else {
    console.log(`  ${stale.length} baselined entr(ies) are FIXED but still listed:`);
    for (const k of stale) console.log(`      ${k}`);
    console.log("");
    console.log("  Remove them so the drift cannot be reintroduced for free:");
    console.log("      node scripts/ci/schema-drift-guard.mjs --write-baseline");
    console.log("  On a long-lived developer cluster this is expected — the baseline is");
    console.log("  measured against a FRESH bootstrap. Re-run with --allow-stale locally.");
  }
}

console.log("──────────────────────────────────────────────────────────────");
if (novel.length > 0 || (stale.length > 0 && ALLOW_STALE === false)) process.exit(1);
console.log(`  RATCHET HOLDING — ${known.size} known drift(s), no new ones.`);
console.log("──────────────────────────────────────────────────────────────");
process.exit(0);
