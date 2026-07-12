#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-pgbouncer-routing.mjs — G8 Connection_Proxy compliance verification
//
// Verifies that every DB_Backed_Service's active database connections are
// established through the Connection_Proxy (PgBouncer, port 6432) rather than
// directly against PostgreSQL. Distinct from `tests/security/connection-budget
// .test.ts`, which only asserts hardcoded arithmetic constants — this script
// inspects LIVE `pg_stat_activity` on a running/staged deployment.
//
// It queries `pg_stat_activity` (via the privileged ops DSN), groups the
// result by `datname`/`application_name`/`client_addr`, cross-references
// against the known 33 `DATABASE_URL_<SVC>` service identities (see
// docs/architecture/CONNECTION-BUDGET.md and the port map in
// .kiro/steering/quick-reference.md), and prints a per-service compliance
// report. Exits non-zero if ANY service is found bypassing the
// Connection_Proxy, while still reporting every compliant service
// individually (never short-circuits on the first violation).
//
// Connection: no new npm dependency is introduced. Like
// scripts/ops/restore-drill.sh and scripts/security/verify-evt3-dlq.mjs, this
// shells out to `psql` (via docker exec against the dev Postgres container, or
// directly when OPS_DSN/PGHOST is provided) rather than adding a `pg`/
// `postgres` dependency to a bare `scripts/` tree that has no package.json.
//
// Usage:
//   node scripts/ops/verify-pgbouncer-routing.mjs             (human report)
//   node scripts/ops/verify-pgbouncer-routing.mjs --json       (machine report)
//
// Connection env vars (first match wins):
//   OPS_DSN          — full privileged connection string, used as-is with psql
//   PG_CONTAINER      — docker container name to `docker exec` into (default: civitasone-postgres)
//   PG_USER           — psql user (default: civitas_admin)
//   PGHOST / PGPORT   — used for a direct (non-docker) psql fallback
//   PGBOUNCER_HOST    — hostname/substring that identifies the Connection_Proxy
//                       as seen in client_addr/client_hostname (default: pgbouncer)
//
// Exit codes:
//   0 — every DB_Backed_Service with observed connections is compliant
//   1 — at least one DB_Backed_Service is bypassing the Connection_Proxy
//   2 — could not query pg_stat_activity (tooling/connection error)
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── 1. Known DB_Backed_Service identities (the canonical 33) ────────────────
// Mirrors the port map in .kiro/steering/quick-reference.md /
// docs/architecture/CONNECTION-BUDGET.md — the same 33 services every
// `DATABASE_URL_<SVC>` override in .env.example is documented against.
export const KNOWN_SERVICES = [
  "identity", "tenant", "policy", "audit", "install", "notification", "finance",
  "procurement", "contract", "estab", "stock", "hrms", "payroll", "project",
  "asset", "report", "plugin", "theme", "grant", "citizen", "legal", "admin",
  "billing", "crm", "inventory", "telephony", "helpdesk", "knowledge",
  "workflow", "queue", "analytics", "location", "gateway",
];

export function dbNameFor(svc) {
  return `civitas_${svc}`;
}

export function envVarFor(svc) {
  return `DATABASE_URL_${svc.toUpperCase()}`;
}

const DEFAULT_PGBOUNCER_HINT = "pgbouncer";

// ── 2. Pure classification logic (fixture-testable, no I/O) ─────────────────
//
// Row shape (as produced by the pg_stat_activity query below, or by a test
// fixture): { datname, application_name, client_addr, client_hostname, count }
// `count` defaults to 1 if omitted (one row = one connection).
function isViaProxy(row, pgbouncerHint) {
  const hint = (pgbouncerHint ?? DEFAULT_PGBOUNCER_HINT).toLowerCase();
  const appName = String(row.application_name ?? "").toLowerCase();
  const clientAddr = String(row.client_addr ?? "").toLowerCase();
  const clientHostname = String(row.client_hostname ?? "").toLowerCase();
  return appName.includes(hint) || clientAddr.includes(hint) || clientHostname.includes(hint);
}

/**
 * Cross-references raw pg_stat_activity-shaped rows against the known
 * DB_Backed_Service identities and produces a per-service compliance report.
 *
 * A service with zero observed connections is reported as compliant (there is
 * nothing bypassing the Connection_Proxy to report) — it still appears in the
 * report individually, satisfying Req 6.2's "report every compliant service".
 *
 * @param {Array<object>} rows - pg_stat_activity-shaped rows (grouped or raw)
 * @param {string[]} services - known service short-names (defaults to the 33)
 * @param {{ pgbouncerHint?: string }} opts
 */
export function classifyFleet(rows, services = KNOWN_SERVICES, opts = {}) {
  const pgbouncerHint = opts.pgbouncerHint ?? process.env.PGBOUNCER_HOST ?? DEFAULT_PGBOUNCER_HINT;
  const dbToService = new Map(services.map((svc) => [dbNameFor(svc), svc]));

  const byService = new Map(
    services.map((svc) => [svc, { service: svc, database: dbNameFor(svc), connections: 0, viaProxy: 0, direct: 0 }]),
  );

  for (const row of rows ?? []) {
    const svc = dbToService.get(row.datname);
    if (!svc) continue; // connection to a database outside the known 33 — ignored
    const entry = byService.get(svc);
    const count = Number.isFinite(row.count) ? row.count : 1;
    entry.connections += count;
    if (isViaProxy(row, pgbouncerHint)) entry.viaProxy += count;
    else entry.direct += count;
  }

  const services_ = [...byService.values()].map((e) => ({
    service: e.service,
    database: e.database,
    envVar: envVarFor(e.service),
    connections: e.connections,
    viaProxy: e.viaProxy,
    direct: e.direct,
    // Compliant iff no directly-observed (non-proxied) connections. A service
    // with zero connections has nothing bypassing the proxy, so it counts as
    // compliant rather than "unknown".
    compliant: e.direct === 0,
  }));

  const nonCompliant = services_.filter((s) => !s.compliant);

  return {
    generatedAt: new Date().toISOString(),
    pgbouncerHint,
    services: services_,
    nonCompliantServices: nonCompliant.map((s) => s.service),
    overallCompliant: nonCompliant.length === 0,
  };
}

// ── 3. Minimal CSV parsing (psql --csv output, no external dep) ─────────────
export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line) => {
    const fields = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  };
  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function toActivityRows(csvRows) {
  return csvRows.map((r) => ({
    datname: r.datname,
    application_name: r.application_name,
    client_addr: r.client_addr,
    client_hostname: r.client_hostname,
    count: Number(r.count ?? 1),
  }));
}

// ── 4. Live pg_stat_activity query (I/O, shells out to psql) ────────────────
const QUERY = [
  "SELECT datname,",
  "       coalesce(application_name, '') AS application_name,",
  "       coalesce(client_addr::text, '') AS client_addr,",
  "       coalesce(client_hostname, '') AS client_hostname,",
  "       count(*) AS count",
  "FROM pg_stat_activity",
  "WHERE datname IS NOT NULL",
  "GROUP BY datname, application_name, client_addr, client_hostname;",
].join(" ");

async function isContainerRunning(name) {
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}"]);
    return stdout.split("\n").map((l) => l.trim()).includes(name);
  } catch {
    return false;
  }
}

async function queryPgStatActivity(env) {
  const opsDsn = env.OPS_DSN;
  const pgContainer = env.PG_CONTAINER ?? "civitasone-postgres";
  const pgUser = env.PG_USER ?? "civitas_admin";
  const pgHost = env.PGHOST ?? "localhost";
  const pgPort = env.PGPORT ?? "5435";

  let stdout;
  if (opsDsn) {
    ({ stdout } = await execFileAsync(
      "psql",
      [opsDsn, "-v", "ON_ERROR_STOP=1", "--csv", "-c", QUERY],
      { maxBuffer: 8 * 1024 * 1024 },
    ));
  } else if (await isContainerRunning(pgContainer)) {
    ({ stdout } = await execFileAsync(
      "docker",
      ["exec", pgContainer, "psql", "-U", pgUser, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--csv", "-c", QUERY],
      { maxBuffer: 8 * 1024 * 1024 },
    ));
  } else {
    ({ stdout } = await execFileAsync(
      "psql",
      ["-h", pgHost, "-p", pgPort, "-U", pgUser, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "--csv", "-c", QUERY],
      { maxBuffer: 8 * 1024 * 1024 },
    ));
  }
  return toActivityRows(parseCsv(stdout));
}

// ── 5. Human-readable report rendering ───────────────────────────────────────
function renderTable(report) {
  const lines = [];
  lines.push("──────────────────────────────────────────────────────────────");
  lines.push("  Connection-Budget Verification — Connection_Proxy routing (G8)");
  lines.push("──────────────────────────────────────────────────────────────");
  lines.push("  Service          Connections   Via PgBouncer   Compliant");
  for (const s of report.services) {
    const svc = s.service.padEnd(16);
    const conns = String(s.connections).padStart(11);
    const viaProxy = (s.connections === 0 ? "—" : s.direct === 0 ? "yes" : "NO (direct)").padStart(15);
    const compliant = s.compliant ? "✅" : "❌";
    lines.push(`  ${svc}${conns}${viaProxy}   ${compliant}`);
  }
  lines.push("");
  lines.push(
    report.overallCompliant
      ? "  ✅ COMPLIANT — every observed connection routes through the Connection_Proxy."
      : `  ❌ NON-COMPLIANT (${report.nonCompliantServices.length} of ${report.services.length} services bypassing Connection_Proxy): ${report.nonCompliantServices.join(", ")}`,
  );
  lines.push("──────────────────────────────────────────────────────────────");
  return lines.join("\n");
}

// ── 6. Run ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");

  let rows;
  try {
    rows = await queryPgStatActivity(process.env);
  } catch (err) {
    const message = err?.stderr?.toString?.() || err?.message || String(err);
    console.error(`verify-pgbouncer-routing: failed to query pg_stat_activity — ${message.trim()}`);
    process.exit(2);
  }

  const report = classifyFleet(rows, KNOWN_SERVICES, { pgbouncerHint: process.env.PGBOUNCER_HOST });

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    console.log(renderTable(report));
  }

  process.exit(report.overallCompliant ? 0 : 1);
}

// Only run when executed directly (not when imported by fixture unit tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`verify-pgbouncer-routing: fatal — ${err?.stack || err}`);
    process.exit(2);
  });
}
