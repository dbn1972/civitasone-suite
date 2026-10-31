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
 * Usage (DATABASE_URL, or an explicit PGHOST+PGPORT, names the cluster; the
 * database name in the URL is ignored, each service's civitas_<svc> is used):
 *   DATABASE_URL=postgres://u:p@127.0.0.1:<disposable>/x node scripts/ci/schema-drift-guard.mjs
 *   ... node scripts/ci/schema-drift-guard.mjs inspection    # one service
 * Exit: 0 clean, 1 on any declared-but-missing column, 2 not configured/refused.
 *
 * F109 — NO DEFAULT DATABASE. This guard used to default to localhost:5435 as
 * civitas_admin, which on the shared host is LIVE UAT. It now connects only where
 * it is told to (DATABASE_URL, else PGHOST+PGPORT, else exit 2) and REFUSES port
 * 5435 or 6432 (live Postgres / its pgbouncer) unless --live-readonly is passed.
 *
 * --live-readonly — post-deploy schema-drift gate (UAT bundle 10, F100). Compares
 * every service database of a target (live) cluster with a disposable cluster
 * built by scripts/ci/bootstrap-postgres.sh: columns, constraints and indexes by
 * NAME and DEFINITION, and RLS/FORCE. The target is only ever read: a READ ONLY
 * transaction under default_transaction_read_only=on, plus `pg_dump -s` (schema
 * only) when --dump-dir is given. Exit 1 on class-(a) drift (an object the
 * migrations create is missing, or differs, on the target). Run it through
 * scripts/ci/live-schema-drift-gate.sh, which builds the expected cluster:
 *   node scripts/ci/schema-drift-guard.mjs --live-readonly \
 *     --expected-url postgres://civitas:pw@127.0.0.1:<disposable>/postgres \
 *     (--live-container civitasone-postgres [--live-user civitas_admin] | DATABASE_URL=<live>) \
 *     [--services procurement,asset] [--dump-dir <dir>]
 *
 * A database that cannot be reached is SKIPPED and named in the output — never
 * silently treated as clean.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { CATALOG_PSQL, compareCatalogs, resolveConnection } from "./schema-catalog-drift.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const LIVE_READONLY = process.argv.includes("--live-readonly");

/** Value of `--name value` on the command line, or undefined. */
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// F109: connect only where told to; never to the live ports unless --live-readonly.
// In --live-readonly mode the connection is resolved by that mode (below).
let PGHOST;
let PGPORT;
let ADMIN_USER;
let ADMIN_PW;
if (!LIVE_READONLY) {
  try {
    ({ host: PGHOST, port: PGPORT, user: ADMIN_USER, password: ADMIN_PW } = resolveConnection(process.env));
  } catch (e) {
    console.error(`schema-drift-guard: ${e.message}`);
    process.exit(2);
  }
}

const only = !LIVE_READONLY && process.argv[2] && process.argv[2].startsWith("--") === false
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

/**
 * Extensions a service's migrations require, read from their own
 * `CREATE EXTENSION [IF NOT EXISTS] <name>` statements.
 *
 * WHY THIS MATTERS: if a required extension is absent, the migrations that need it
 * abort and their tables are never created — so every column they declare shows up
 * as drift. That is a property of the CLUSTER, not of the code, and counting it as
 * drift makes the number depend on which host you measure from.
 *
 * Concretely: six location-service migrations begin with CREATE EXTENSION postgis.
 * The CI service container is postgis/postgis:16-3.4 so they succeed there, but the
 * dev cluster on :5435 is a plain Postgres with postgis NOT AVAILABLE at all (dev
 * runs PostGIS in a separate container on :5436). Measured 2026-07-27: that single
 * difference accounted for 68 columns — every one of them location-service.
 *
 * Such a service is SKIPPED and named, exactly like an unreachable database. It is
 * never silently treated as clean, and --write-baseline refuses to run when
 * anything was skipped.
 */
function requiredExtensionsFor(svc) {
  const migDir = join(SERVICES_DIR, `${svc}-service`, "migrations");
  if (existsSync(migDir) === false) return [];
  const found = new Set();
  for (const f of readdirSync(migDir)) {
    if (f.endsWith(".sql") === false) continue;
    const src = readFileSync(join(migDir, f), "utf8");
    // [\w-]+ not \w+: extension names may contain hyphens ("uuid-ossp"), and
    // stopping at the hyphen produced a phantom extension called "uuid" that no
    // cluster has, so court and meeting were skipped for a reason that did not exist.
    for (const m of src.matchAll(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?/gi)) {
      // pgcrypto is created by the bootstrap in every database; listing it would
      // add noise without ever being the reason a service is skipped.
      if (m[1].toLowerCase() !== "pgcrypto") found.add(m[1].toLowerCase());
    }
  }
  return [...found].sort();
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

// Database name is `civitas_<svc>` with one exception: ai-agent-service's
// role/DB predate this convention and use an underscore (civitas_ai_agent,
// see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map) rather than the
// hyphen every other multi-word service name would produce. Mirrors
// tenant-index-guard.mjs's own DB_NAME_OVERRIDES (kept in sync manually —
// there is no shared module between the two guards) rather than parsing
// bootstrap-postgres.sh's bash map at runtime. Without this, ai-agent
// resolved to civitas_ai-agent, which never exists, so ai-agent-service's
// 8 schema.ts files were silently skipped rather than checked (PERF-023).
const DB_NAME_OVERRIDES = { "ai-agent": "civitas_ai_agent" };
function dbNameFor(svc) {
  return DB_NAME_OVERRIDES[svc] ?? `civitas_${svc}`;
}

// ── --live-readonly: post-deploy schema-drift gate ───────────────────────────
if (LIVE_READONLY) {
  const fail = (msg) => {
    console.error(`schema-drift-guard --live-readonly: ${msg}`);
    process.exit(2);
  };
  const expectedUrl = argValue("--expected-url");
  if (!expectedUrl) fail("--expected-url <disposable cluster built by bootstrap-postgres.sh> is required");
  let expected;
  try {
    // The EXPECTED side is never live: a live port there is refused outright.
    expected = resolveConnection({ DATABASE_URL: expectedUrl });
  } catch (e) {
    fail(`--expected-url: ${e.message}`);
  }
  const liveContainer = argValue("--live-container");
  const liveUser = argValue("--live-user") ?? "civitas_admin";
  let live = null;
  if (!liveContainer) {
    try {
      live = resolveConnection(process.env, { allowLive: true });
    } catch (e) {
      fail(`target: ${e.message} (or pass --live-container <name>)`);
    }
    if (live.host === expected.host && live.port === expected.port) fail("target and expected are the same cluster");
  }
  const dumpDir = argValue("--dump-dir");
  const wanted = argValue("--services")?.split(",").map((x) => x.trim()).filter(Boolean);
  const READ_ONLY = "-c default_transaction_read_only=on";

  const runExpected = (db, input) =>
    execFileSync("psql", ["-h", expected.host, "-p", expected.port, "-U", expected.user, "-d", db, "-X", "-At", "-q", "-f", "-"], {
      input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000,
      env: { ...process.env, PGPASSWORD: expected.password, PGOPTIONS: READ_ONLY },
    });
  const runLive = (tool, db, args, input) =>
    liveContainer
      ? execFileSync("docker", ["exec", "-i", "-e", `PGOPTIONS=${READ_ONLY}`, liveContainer, tool, "-U", liveUser, "-d", db, ...args], {
          input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000,
        })
      : execFileSync(tool, ["-h", live.host, "-p", live.port, "-U", live.user, "-d", db, ...args], {
          input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000,
          env: { ...process.env, PGPASSWORD: live.password, PGOPTIONS: READ_ONLY },
        });

  let expectedDbs;
  try {
    expectedDbs = new Set(runExpected("postgres", "SELECT datname FROM pg_database;").split("\n").map((x) => x.trim()));
  } catch (e) {
    fail(`expected cluster unreachable: ${String(e.message).split("\n")[0]}`);
  }

  const svcs = readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service") && existsSync(join(SERVICES_DIR, d, "migrations")))
    .map((d) => d.replace("-service", ""))
    .filter((s) => (wanted ? wanted.includes(s) : true))
    .sort();
  if (wanted) for (const w of wanted) if (!svcs.includes(w)) fail(`unknown service: ${w}`);

  const skippedLive = [];
  const results = [];
  for (const svc of svcs) {
    const db = dbNameFor(svc);
    if (!expectedDbs.has(db)) {
      skippedLive.push(`${svc} (${db} not in the expected cluster)`);
      continue;
    }
    const required = requiredExtensionsFor(svc);
    if (required.length > 0) {
      const have = new Set(runExpected(db, "SELECT extname FROM pg_extension;").split("\n").map((x) => x.trim()));
      const absent = required.filter((x) => !have.has(x));
      if (absent.length > 0) {
        skippedLive.push(`${svc} (expected cluster lacks extension: ${absent.join(", ")})`);
        continue;
      }
    }
    const exp = runExpected(db, CATALOG_PSQL);
    let tgt;
    try {
      tgt = runLive("psql", db, ["-X", "-At", "-q", "-f", "-"], CATALOG_PSQL);
    } catch (e) {
      results.push({ svc, db, fail: [`target database unreachable: ${String(e.message).split("\n")[0]}`], warn: [], info: [] });
      continue;
    }
    if (dumpDir) {
      try {
        writeFileSync(join(dumpDir, `${db}.schema.sql`), runLive("pg_dump", db, ["-s", "--no-owner", "--no-privileges"]));
      } catch (e) {
        console.error(`  (pg_dump -s ${db} failed: ${String(e.message).split("\n")[0]})`);
      }
    }
    results.push({ svc, db, ...compareCatalogs(exp, tgt) });
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Live schema-drift gate — target vs migration-built schema (read-only)");
  console.log("──────────────────────────────────────────────────────────────");
  let failing = 0;
  for (const r of results) {
    const head = `  ${r.svc.padEnd(16)} fail=${r.fail.length} warn=${r.warn.length} info=${r.info.length}`;
    console.log(head);
    if (r.fail.length > 0) failing += 1;
    for (const f of r.fail) console.log(`      FAIL ${f}`);
    for (const w of r.warn) console.log(`      WARN ${w}`);
    if (process.argv.includes("--verbose")) for (const i of r.info) console.log(`      info ${i}`);
  }
  if (skippedLive.length > 0) {
    console.log(`  SKIPPED (NOT verified): ${skippedLive.length}`);
    for (const s of skippedLive) console.log(`      ${s}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  if (results.length === 0) {
    console.error("  UNMEASURED — no service database was compared. This is not a pass.");
    process.exit(2);
  }
  if (failing > 0) {
    console.error(`  DRIFT: ${failing} service database(s) differ from their migrations (class a).`);
    process.exit(1);
  }
  console.log(`  CLEAN — ${results.length} service database(s) match their migrations.`);
  process.exit(0);
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

  const db = dbNameFor(svc);
  const live = psql(
    db,
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  );
  if (live === null) {
    skipped.push(`${svc} (${db} unreachable)`);
    continue;
  }

  // A missing required extension means the migrations that need it aborted, so
  // their columns would all read as drift. That is a cluster capability gap, not a
  // code defect — skip and name it rather than counting it.
  const required = requiredExtensionsFor(svc);
  if (required.length > 0) {
    const installed = psql(db, "SELECT extname FROM pg_extension");
    const have = new Set(
      (installed ?? "").split("\n").map((r) => r.trim().toLowerCase()).filter(Boolean),
    );
    const absent = required.filter((e) => have.has(e) === false);
    if (absent.length > 0) {
      skipped.push(`${svc} (${db} lacks required extension: ${absent.join(", ")})`);
      continue;
    }
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
  console.log(`  SKIPPED (NOT verified — unreachable or missing extension): ${skipped.length}`);
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
      `  REFUSING to write a baseline: ${skipped.length} database(s) were not verified\n` +
        `  (unreachable, or missing an extension their migrations require).\n` +
        `  Their drift is unknown and would be silently recorded as zero.\n` +
        `  Fix them first: ${skipped.join(", ")}`,
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
