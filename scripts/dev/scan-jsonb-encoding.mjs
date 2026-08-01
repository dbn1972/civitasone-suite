#!/usr/bin/env node
/**
 * scan-jsonb-encoding.mjs — report jsonb/json columns holding DOUBLE-ENCODED values.
 *
 * ─── The defect this detects ────────────────────────────────────────────────
 * Drizzle's jsonb mapper calls JSON.stringify(value), handing the driver a
 * STRING. postgres.js then applies its own json serializer (also JSON.stringify)
 * to any parameter whose Postgres-inferred type is json/jsonb. The value is
 * therefore encoded twice and the column ends up holding a jsonb *string* whose
 * text is the intended document.
 *
 * Application reads mask it completely — postgres.js parses once and Drizzle's
 * mapFromDriverValue parses again, so the two decodes cancel and TypeScript sees
 * the right object. But anything evaluated INSIDE Postgres sees a scalar string:
 * `col->>'key'` returns NULL, `col @> '{...}'` never matches, GIN index lookups
 * return nothing, and `jsonb_array_elements(col)` errors. That is why this went
 * unnoticed across several sprints.
 *
 * ─── What counts as corrupt ─────────────────────────────────────────────────
 * ONLY a jsonb string whose inner text begins with `{` or `[`. A jsonb string
 * holding "hello" is a legitimate JSON scalar and is deliberately left alone —
 * conflating the two would corrupt good data while fixing bad.
 *
 * Read-only. Never writes. Use repair-jsonb-encoding.mjs to remediate.
 *
 * Usage:
 *   node scripts/dev/scan-jsonb-encoding.mjs
 *   node scripts/dev/scan-jsonb-encoding.mjs --db civitas_cdp
 *   node scripts/dev/scan-jsonb-encoding.mjs --json
 */
import { execFileSync } from "node:child_process";

const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5435";
const USER = process.env.PGUSER ?? "civitas_admin";
const PASS = process.env.PGPASSWORD ?? "civitas_dev_pw";

const argv = process.argv.slice(2);
const onlyDb = argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : null;
const asJson = argv.includes("--json");

/** Run SQL via psql. Args are passed as an array so no shell interpolation occurs. */
function q(db, sql) {
  return execFileSync(
    "psql",
    ["-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-tAF\u001f", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: { ...process.env, PGPASSWORD: PASS }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
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

function jsonbColumns(db) {
  return q(
    db,
    `SELECT c.table_schema, c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.data_type IN ('jsonb','json')
        AND c.table_schema NOT IN ('pg_catalog','information_schema')
      ORDER BY 1,2,3`,
  );
}

const findings = [];
const errors = [];
const dbs = onlyDb ? [onlyDb] : databases();

for (const db of dbs) {
  let cols;
  try {
    cols = jsonbColumns(db);
  } catch (err) {
    errors.push({ db, error: String(err.message).split("\n")[0].slice(0, 100) });
    continue;
  }
  for (const [schema, table, column] of cols) {
    // Identifiers come from information_schema, but quote them anyway so a
    // mixed-case or reserved-word name cannot break the statement.
    const ref = `"${schema}"."${table}"`;
    const col = `"${column}"`;
    const sql = `SELECT count(*)::int,
      count(*) FILTER (WHERE jsonb_typeof(${col}::jsonb) = 'string')::int,
      count(*) FILTER (WHERE jsonb_typeof(${col}::jsonb) = 'string'
                         AND left(btrim(${col}::jsonb #>> '{}'), 1) IN ('{','['))::int
      FROM ${ref} WHERE ${col} IS NOT NULL`;
    try {
      const [[total, scalars, bad]] = q(db, sql);
      if (Number(bad) > 0) {
        findings.push({
          db, schema, table, column,
          total: Number(total),
          doubleEncoded: Number(bad),
          legitScalars: Number(scalars) - Number(bad),
        });
      }
    } catch (err) {
      errors.push({ db, schema, table, column, error: String(err.message).split("\n").slice(-3).join(" ").slice(0, 100) });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ findings, errors }, null, 2));
} else if (findings.length === 0) {
  console.log(`No double-encoded jsonb found across ${dbs.length} database(s).`);
} else {
  console.log(`Double-encoded jsonb columns (${findings.length}):\n`);
  console.log(" rows  column");
  for (const f of findings.sort((a, b) => b.doubleEncoded - a.doubleEncoded)) {
    console.log(`${String(f.doubleEncoded).padStart(5)}  ${f.db}.${f.schema}.${f.table}.${f.column} (of ${f.total} non-null)`);
  }
  console.log(`\nTotal corrupt rows: ${findings.reduce((n, f) => n + f.doubleEncoded, 0)}`);
  const legit = findings.reduce((n, f) => n + f.legitScalars, 0);
  if (legit > 0) console.log(`Legitimate jsonb scalars left untouched: ${legit}`);
}
if (errors.length) {
  console.log(`\nCould not scan ${errors.length} target(s):`);
  for (const e of errors.slice(0, 15)) {
    console.log(`  ${[e.db, e.schema, e.table, e.column].filter(Boolean).join(".")}: ${e.error}`);
  }
}
