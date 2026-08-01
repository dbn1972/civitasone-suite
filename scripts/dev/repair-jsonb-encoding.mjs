#!/usr/bin/env node
/**
 * repair-jsonb-encoding.mjs — remediate DOUBLE-ENCODED jsonb values in place.
 *
 * Companion to scan-jsonb-encoding.mjs (read-only detector). Read that file
 * first for the full description of the defect. In short: a jsonb column holds a
 * jsonb *string* whose text is the intended JSON document, because the value was
 * JSON.stringify'd twice on the write path. Application reads mask it (two
 * decodes cancel); everything evaluated inside Postgres sees a scalar string, so
 * `col->>'key'` is NULL, `col @> '{...}'` never matches and GIN lookups return
 * nothing.
 *
 * The correction is `col = (col #>> '{}')::jsonb` — extract the inner text of
 * the jsonb string and re-parse it.
 *
 * ─── What this repairs, exactly ─────────────────────────────────────────────
 * A row is repaired ONLY when ALL of:
 *   1. jsonb_typeof(col) = 'string'                      — it is a jsonb string
 *   2. left(btrim(col #>> '{}'), 1) IN ('{','[')         — inner text looks like
 *                                                          an object or array
 *   3. (col #>> '{}') IS JSON                            — inner text actually
 *                                                          parses as JSON
 * A jsonb string holding "hello" is a LEGITIMATE JSON scalar. It fails (2) and
 * is left alone. The predicate is deliberately NOT widened to `'"'` or to all
 * strings — doing so would corrupt good data while fixing bad.
 *
 * ─── Safety posture ─────────────────────────────────────────────────────────
 *   - UPDATE only. Never CREATE / DROP / ALTER / DELETE anything.
 *   - Dry-run by default; writes require --apply.
 *   - Refuses any database whose name does not match ^civitas_ (wrong-host guard).
 *   - lock_timeout + statement_timeout set per session, so a stuck batch cannot
 *     wedge a database.
 *   - Batched and committed per batch (one psql invocation per batch, autocommit),
 *     so a 13k-row table never holds a long transaction or a long lock.
 *   - Idempotent: a repaired row is no longer jsonb_typeof = 'string', so it
 *     self-excludes. Re-running is a no-op.
 *   - Resumable: because it is idempotent and committed per batch, Ctrl-C at any
 *     point leaves every database consistent. Re-run to continue where it stopped.
 *   - NEVER prints row contents. audit.events.payload and _outbox.messages.payload
 *     carry citizen PII. Identifiers and counts only; psql errors are redacted.
 *
 * ─── Partitioned tables ─────────────────────────────────────────────────────
 * The scanner lists both the partitioned parent (e.g. _outbox.messages) and each
 * leaf partition (_outbox.messages_y2026m07), so its totals double-count. This
 * script repairs LEAF PARTITIONS ONLY and skips partitioned parents
 * (pg_class.relkind = 'p'). Reasons:
 *   - Batching keys off ctid, which is unique per physical relation but NOT
 *     across a partition hierarchy. `WHERE ctid IN (...)` against a parent could
 *     match an unrelated row in a different partition.
 *   - Every row of a partitioned table lives in exactly one leaf, so leaf-only
 *     coverage is complete — nothing is missed.
 *   - Locks stay scoped to one partition at a time instead of the whole hierarchy.
 *   - The repaired column is never a partition key, so no row movement occurs.
 * `--table <schema.parent>` still works: it matches the parent's leaves too.
 *
 * Usage:
 *   node scripts/dev/repair-jsonb-encoding.mjs --help
 *   node scripts/dev/repair-jsonb-encoding.mjs --db civitas_cdp            # dry-run
 *   node scripts/dev/repair-jsonb-encoding.mjs --db civitas_cdp --apply
 *   node scripts/dev/repair-jsonb-encoding.mjs --db civitas_audit --table events.events --apply
 */
import { execFileSync } from "node:child_process";

const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5435";
const USER = process.env.PGUSER ?? "civitas_admin";
const PASS = process.env.PGPASSWORD ?? "civitas_dev_pw";

const HELP = `repair-jsonb-encoding.mjs — repair double-encoded jsonb values (UPDATE only).

  --apply                    Perform writes. WITHOUT THIS FLAG NOTHING IS WRITTEN.
  --db <name>                Repair one database only. Must match ^civitas_.
  --table <schema.table>     Repair one table only. Matches a partitioned parent's
                             leaf partitions as well.
  --column <name>            Repair one column name only (matches in any table).
  --batch-size <n>           Rows per UPDATE statement, committed per batch.
                             Default 1000.
  --lock-timeout <t>         Per-session lock_timeout. Default 5s.
  --statement-timeout <t>    Per-session statement_timeout. Default 60s.
  --json                     Emit a machine-readable summary instead of a report.
  --help                     Show this.

Exit codes: 0 = clean (dry-run, or apply left nothing behind) · 1 = corrupt rows
remain or errors occurred · 2 = usage error / refused target.

Safe to interrupt: the repair is idempotent and committed per batch, so Ctrl-C
leaves the database consistent. Re-run to resume.

Detect first with the read-only scanner:
  node scripts/dev/scan-jsonb-encoding.mjs --db civitas_cdp`;

// ─── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => (argv.includes(name) ? (argv[argv.indexOf(name) + 1] ?? fallback) : fallback);

if (flag("--help") || flag("-h")) {
  console.log(HELP);
  process.exit(0);
}

const APPLY = flag("--apply");
const onlyDb = opt("--db");
const onlyTable = opt("--table");
const onlyColumn = opt("--column");
const asJson = flag("--json");
const LOCK_TIMEOUT = opt("--lock-timeout", "5s");
const STMT_TIMEOUT = opt("--statement-timeout", "60s");

const showProgress = !asJson && Boolean(process.stdout.isTTY);

const BATCH = Number(opt("--batch-size", "1000"));
if (!Number.isInteger(BATCH) || BATCH < 1 || BATCH > 100000) {
  console.error(`--batch-size must be an integer between 1 and 100000 (got ${opt("--batch-size")})`);
  process.exit(2);
}
for (const need of ["--db", "--table", "--column"]) {
  if (argv.includes(need) && !opt(need)) {
    console.error(`${need} requires a value`);
    process.exit(2);
  }
}
if (onlyTable && !onlyTable.includes(".")) {
  console.error(`--table must be schema-qualified, e.g. --table events.events (got ${onlyTable})`);
  process.exit(2);
}

/** Wrong-host guard: this script writes, so it only ever touches CivitasOne DBs. */
const DB_NAME = /^civitas_[a-z0-9_]+$/;
if (onlyDb && !DB_NAME.test(onlyDb)) {
  console.error(`Refusing to run against "${onlyDb}": database name must match ^civitas_ (wrong-host guard).`);
  process.exit(2);
}

// ─── psql plumbing (same conventions as scan-jsonb-encoding.mjs) ─────────────
// Args are passed as an array, so no shell interpolation ever occurs. Timeouts
// are injected via PGOPTIONS so they apply to every statement in the session,
// including the counting queries — a stuck batch cannot wedge a database.
const PGOPTIONS = [
  `-c lock_timeout=${LOCK_TIMEOUT}`,
  `-c statement_timeout=${STMT_TIMEOUT}`,
  "-c idle_in_transaction_session_timeout=30s",
].join(" ");

/**
 * Redact anything that could be a data value before it reaches stdout. Postgres
 * error messages quote offending input, and these columns carry citizen PII.
 */
function redact(message) {
  const line = String(message)
    .split("\n")
    .find((l) => l.includes("ERROR:")) ?? String(message).split("\n")[0] ?? "";
  return line
    .replace(/'[^']{8,}'/g, "'[redacted]'")
    .replace(/"[^"]{40,}"/g, '"[redacted]"')
    .trim()
    .slice(0, 200);
}

function q(db, sql) {
  return execFileSync(
    "psql",
    ["-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-tAF\u001f", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: { ...process.env, PGPASSWORD: PASS, PGOPTIONS },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u001f"));
}

function databases() {
  return q(
    "postgres",
    `SELECT datname FROM pg_database
      WHERE datname LIKE 'civitas_%' AND datname <> 'civitas_admin'
        AND NOT datistemplate AND datallowconn
      ORDER BY datname`,
  ).map((r) => r[0]);
}

/** Quote an identifier that came from the catalog. Defensive, not decorative. */
const id = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * jsonb/json columns of PHYSICAL tables only (relkind='r'), which excludes
 * partitioned parents (relkind='p') while keeping their leaves. Also reports the
 * inheritance parent so --table can target a parent and hit all its partitions.
 */
function targetColumns(db) {
  return q(
    db,
    `SELECT c.table_schema, c.table_name, c.column_name, c.udt_name,
            cl.relkind, cl.relispartition,
            coalesce(pns.nspname || '.' || pc.relname, '')
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
       JOIN pg_namespace ns ON ns.nspname = c.table_schema
       JOIN pg_class cl ON cl.relnamespace = ns.oid AND cl.relname = c.table_name
       LEFT JOIN pg_inherits inh ON inh.inhrelid = cl.oid
       LEFT JOIN pg_class pc ON pc.oid = inh.inhparent
       LEFT JOIN pg_namespace pns ON pns.oid = pc.relnamespace
      WHERE c.data_type IN ('jsonb','json')
        AND c.table_schema NOT IN ('pg_catalog','information_schema')
      ORDER BY 1,2,3`,
  ).map(([schema, table, column, udt, relkind, relispartition, parent]) => ({
    schema,
    table,
    column,
    udt,
    isParent: relkind === "p",
    isPartition: relispartition === "t",
    parent,
  }));
}

// ─── the predicate, in one place ─────────────────────────────────────────────
// (1) it is a jsonb string, (2) the inner text opens an object or an array, and
// (3) the inner text really parses as JSON.
//
// (3) is the JSON-validity guard. Postgres has no try_cast_to_jsonb, and a plain
// text value that merely starts with '{' would abort the whole batch on the cast.
// PostgreSQL 16 gives us the SQL/JSON `IS JSON` predicate, which is a true
// non-throwing validity test — strictly better than a hand-rolled regex, which
// can only approximate JSON and would either let bad rows through or exclude
// good ones. Support is probed once per database; if a server predates 16 the
// script falls back to a conservative regex. Either way each batch is a single
// autocommit statement, so a failure rolls back that batch alone and the run
// continues — belt and braces.
const REGEX_FALLBACK = String.raw`^[[:space:]]*[[{].*[]}][[:space:]]*$`;

function predicate(colExpr, hasIsJson) {
  const inner = `${colExpr} #>> '{}'`;
  const valid = hasIsJson ? `(${inner}) IS JSON` : `(${inner}) ~ '${REGEX_FALLBACK}'`;
  return `jsonb_typeof(${colExpr}) = 'string' AND left(btrim(${inner}), 1) IN ('{','[') AND ${valid}`;
}

function probeIsJson(db) {
  try {
    q(db, `SELECT ('{}' IS JSON)`);
    return true;
  } catch {
    return false;
  }
}

// ─── per-column operations ───────────────────────────────────────────────────
function counts(db, t, hasIsJson) {
  const ref = `${id(t.schema)}.${id(t.table)}`;
  // Cast to jsonb for inspection so a legacy `json` column behaves identically.
  const c = `${id(t.column)}::jsonb`;
  const inner = `${c} #>> '{}'`;
  const looksStructured = `jsonb_typeof(${c}) = 'string' AND left(btrim(${inner}), 1) IN ('{','[')`;
  const [row] = q(
    db,
    `SELECT count(*)::int,
            count(*) FILTER (WHERE ${looksStructured})::int,
            count(*) FILTER (WHERE ${predicate(c, hasIsJson)})::int,
            count(*) FILTER (WHERE jsonb_typeof(${c}) = 'string'
                               AND left(btrim(${inner}), 1) NOT IN ('{','['))::int
       FROM ${ref} WHERE ${id(t.column)} IS NOT NULL`,
  );
  const [total, structured, repairable, legitScalars] = row.map(Number);
  return { total, corrupt: structured, repairable, unparseable: structured - repairable, legitScalars };
}

/**
 * One batch: pick up to BATCH victim ctids, update them, return how many changed.
 *
 * The corruption predicate is re-checked in the UPDATE's own WHERE clause, not
 * just in the CTE. ctid is stable within a single statement's snapshot, but
 * re-checking means that even a ctid pointing somewhere unexpected can never
 * rewrite a legitimate scalar. Cheap insurance on tables holding citizen data.
 *
 * No ORDER BY on the victim scan: it lets LIMIT stop early instead of sorting
 * the whole relation on every batch. A seq scan yields rows in physical order,
 * so lock acquisition order stays consistent between batches anyway.
 */
function repairBatch(db, t, hasIsJson) {
  const ref = `${id(t.schema)}.${id(t.table)}`;
  const col = id(t.column);
  const c = `${col}::jsonb`;
  const pred = predicate(c, hasIsJson);
  const [[n]] = q(
    db,
    `WITH victims AS (
        SELECT ctid FROM ${ref} WHERE ${col} IS NOT NULL AND ${pred} LIMIT ${BATCH}
     ), upd AS (
        UPDATE ${ref} SET ${col} = (${c} #>> '{}')::${t.udt === "json" ? "json" : "jsonb"}
         WHERE ctid IN (SELECT ctid FROM victims) AND ${pred}
        RETURNING 1
     )
     SELECT count(*)::int FROM upd`,
  );
  return Number(n);
}

// ─── run ─────────────────────────────────────────────────────────────────────
const started = Date.now();
const results = [];
const errors = [];
const skipped = { parents: 0, filtered: 0 };

let dbs;
try {
  dbs = onlyDb ? [onlyDb] : databases();
} catch (err) {
  console.error(`Could not enumerate databases: ${redact(err.message)}`);
  process.exit(1);
}

const refused = dbs.filter((d) => !DB_NAME.test(d));
if (refused.length) {
  console.error(`Refusing to run: ${refused.join(", ")} does not match ^civitas_ (wrong-host guard).`);
  process.exit(2);
}

if (!asJson) {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} — ${dbs.length} database(s), batch size ${BATCH}, ` +
      `lock_timeout=${LOCK_TIMEOUT}, statement_timeout=${STMT_TIMEOUT}`,
  );
  if (!APPLY) console.log("Nothing will be written. Re-run with --apply to repair.\n");
  else console.log("Writes ENABLED. Safe to interrupt: idempotent and committed per batch.\n");
}

for (const db of dbs) {
  let cols;
  let hasIsJson;
  try {
    hasIsJson = probeIsJson(db);
    cols = targetColumns(db);
  } catch (err) {
    errors.push({ db, error: redact(err.message) });
    continue;
  }

  for (const t of cols) {
    if (t.isParent) {
      skipped.parents += 1; // repaired through its leaf partitions instead
      continue;
    }
    const qualified = `${t.schema}.${t.table}`;
    if (onlyTable && onlyTable !== qualified && onlyTable !== t.parent) {
      skipped.filtered += 1;
      continue;
    }
    if (onlyColumn && onlyColumn !== t.column) {
      skipped.filtered += 1;
      continue;
    }

    const label = `${db}.${qualified}.${t.column}`;
    let found;
    try {
      found = counts(db, t, hasIsJson);
    } catch (err) {
      errors.push({ db, table: qualified, column: t.column, phase: "count", error: redact(err.message) });
      continue;
    }
    if (found.corrupt === 0) continue;

    const t0 = Date.now();
    let repaired = 0;
    let batches = 0;
    let failed = false;

    if (APPLY) {
      for (;;) {
        let n;
        try {
          n = repairBatch(db, t, hasIsJson);
        } catch (err) {
          errors.push({ db, table: qualified, column: t.column, phase: "repair", error: redact(err.message) });
          failed = true;
          break; // this batch rolled back on its own; move to the next column
        }
        if (n === 0) break; // nothing left this predicate can fix
        batches += 1;
        repaired += n;
        // Live counter, TTY only, kept under one terminal line so the carriage
        // return actually rewinds it instead of leaving a wrapped remnant.
        if (showProgress) {
          process.stdout.write(`\r\u001b[2K  ${`${label}: ${repaired}/${found.repairable}`.slice(0, 74)}`);
        }
      }
      if (showProgress) process.stdout.write("\r\u001b[2K");
    }

    const elapsedMs = Date.now() - t0;
    results.push({
      db,
      schema: t.schema,
      table: t.table,
      column: t.column,
      partition: t.isPartition,
      parent: t.parent || null,
      rows: found.total,
      found: found.corrupt,
      repairable: found.repairable,
      unparseable: found.unparseable,
      legitScalars: found.legitScalars,
      repaired,
      batches,
      elapsedMs,
      failed,
    });

    if (!asJson) {
      const notes = [];
      if (APPLY && repaired > 0) notes.push(`${batches} batch(es)`);
      if (found.unparseable) notes.push(`${found.unparseable} unparseable, skipped`);
      if (found.legitScalars) notes.push(`${found.legitScalars} legit scalar(s) untouched`);
      if (t.isPartition) notes.push(`partition of ${t.parent}`);
      if (failed) notes.push("ERRORED");
      console.log(
        `  ${label}\n` +
          `      found ${found.corrupt} · ${APPLY ? `repaired ${repaired}` : `would repair ${found.repairable}`}` +
          ` · ${(elapsedMs / 1000).toFixed(2)}s${notes.length ? ` · ${notes.join(", ")}` : ""}`,
      );
    }
  }
}

// ─── verification pass ───────────────────────────────────────────────────────
// After applying, re-count corrupt rows for every column we touched. This is an
// independent read, not a reuse of the loop's own bookkeeping.
const remaining = [];
if (APPLY) {
  if (!asJson) console.log("\nVerifying...");
  for (const r of results) {
    const t = { schema: r.schema, table: r.table, column: r.column, udt: "jsonb" };
    try {
      const after = counts(r.db, t, probeIsJson(r.db));
      r.remaining = after.corrupt;
      r.legitScalarsAfter = after.legitScalars;
      if (after.corrupt > 0) remaining.push({ ...r, remaining: after.corrupt, unparseable: after.unparseable });
    } catch (err) {
      errors.push({ db: r.db, table: `${r.schema}.${r.table}`, column: r.column, phase: "verify", error: redact(err.message) });
    }
  }
}

// ─── report ──────────────────────────────────────────────────────────────────
const totalFound = results.reduce((n, r) => n + r.found, 0);
const totalRepairable = results.reduce((n, r) => n + r.repairable, 0);
const totalRepaired = results.reduce((n, r) => n + r.repaired, 0);
const totalUnparseable = results.reduce((n, r) => n + r.unparseable, 0);
const totalLegit = results.reduce((n, r) => n + r.legitScalars, 0);
const totalRemaining = remaining.reduce((n, r) => n + r.remaining, 0);
const wallMs = Date.now() - started;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        batchSize: BATCH,
        databases: dbs,
        totals: {
          columnsAffected: results.length,
          found: totalFound,
          repairable: totalRepairable,
          repaired: totalRepaired,
          unparseableSkipped: totalUnparseable,
          legitScalarsUntouched: totalLegit,
          remaining: totalRemaining,
          elapsedMs: wallMs,
        },
        partitionedParentColumnsSkipped: skipped.parents,
        columns: results,
        errors,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\n${"─".repeat(72)}`);
  if (results.length === 0) {
    console.log(`No double-encoded jsonb found across ${dbs.length} database(s).`);
  } else {
    console.log(`Columns affected:            ${results.length}`);
    console.log(`Corrupt rows found:          ${totalFound}`);
    console.log(`${APPLY ? "Rows repaired:              " : "Rows that would be repaired:"} ${APPLY ? totalRepaired : totalRepairable}`);
    if (totalUnparseable) console.log(`Unparseable inner text:      ${totalUnparseable} (skipped, needs manual review)`);
    if (totalLegit) console.log(`Legitimate scalars untouched: ${totalLegit}`);
  }
  console.log(`Parent-table columns skipped: ${skipped.parents} (partitioned parents; repaired via their leaf partitions)`);
  console.log(`Elapsed:                     ${(wallMs / 1000).toFixed(2)}s`);

  if (APPLY) {
    if (totalRemaining === 0) console.log("\nVerification: 0 corrupt rows remain in the columns touched.");
    else {
      console.log(`\nVerification FAILED — ${totalRemaining} corrupt row(s) remain:`);
      for (const r of remaining.slice(0, 20)) {
        console.log(`  ${r.db}.${r.schema}.${r.table}.${r.column}: ${r.remaining} remaining (${r.unparseable} unparseable)`);
      }
    }
  } else if (results.length > 0) {
    console.log("\nNothing was written. Re-run with --apply to repair.");
  }

  if (errors.length) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 15)) {
      console.log(`  [${e.phase ?? "discover"}] ${[e.db, e.table, e.column].filter(Boolean).join(".")}: ${e.error}`);
    }
  }
}

process.exit(APPLY && (totalRemaining > 0 || errors.length > 0) ? 1 : errors.length > 0 ? 1 : 0);
