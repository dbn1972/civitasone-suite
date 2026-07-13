#!/usr/bin/env node
/**
 * provision-silo-tenant.mjs — provision a SILO tenant's dedicated database.
 *
 * Option B: a silo tenant has ONE physical database that hosts EVERY service's
 * pg schema (budget, gl, files, hrms, …). This creates that DB and applies all
 * services' migrations into it, so every service can connect there and use its
 * own schema. Idempotent (migrations are CREATE … IF NOT EXISTS).
 *
 * This CLI script is now a thin wrapper around `provisionSiloDatabase`
 * (`services/install-service/src/modules/provisioning/actuator.ts`) — the
 * exact `CREATE DATABASE IF NOT EXISTS` + per-service migration-directory-walk
 * + `IF NOT EXISTS`-tolerant apply loop lives ONLY in that shared function now,
 * so this script and the install-service Provisioning_Actuator (task 7.7) can
 * never drift (task 7.5).
 *
 * Usage:
 *   node scripts/dev/provision-silo-tenant.mjs <tenantUuid> [dbName]
 *
 * Requires `services/install-service` to be built (`pnpm --filter
 * @civitasone/install-service build`) so `dist/modules/provisioning/
 * actuator.js` exists — this script imports the compiled actuator directly,
 * the same way `scripts/ops/publish-drill-report.mjs` imports other
 * workspace packages' `dist/` output.
 *
 * Connection: builds its own privileged `runnerConn` (postgres-js client, via
 * `@civitasone/db`'s `createSqlClient`) pointed at the dev Postgres container
 * (localhost:5435, civitas_admin) — never sourced from a service's
 * `DATABASE_URL`. In production this runs as a privileged ops/CI job with the
 * cluster admin DSN (or `PROVISIONING_RUNNER_DSN` once task 7.7 wires the
 * actuator into the worker) — a microservice never holds CREATE DATABASE
 * creds.
 *
 * No new npm dependency is introduced: `postgres` is imported transitively
 * via `@civitasone/db`'s compiled `dist/` output — the same relative-import
 * pattern already used by other bare-`scripts/` tooling (e.g.
 * `scripts/ops/publish-drill-report.mjs` → `packages/queue/dist/index.js`) —
 * rather than adding a `postgres` dependency directly to a `scripts/` tree
 * that has no `package.json`.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient } from "../../packages/db/dist/index.js";
import { provisionSiloDatabase } from "../../services/install-service/dist/modules/provisioning/actuator.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const tenantId = process.argv[2];
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error("Usage: node scripts/dev/provision-silo-tenant.mjs <tenantUuid> [dbName]");
  process.exit(1);
}
const shortId = tenantId.replace(/-/g, "").slice(0, 16);
const dbName = process.argv[3] ?? `civitas_tenant_${shortId}`;

/**
 * Privileged runner connection (Req 3.7): a scoped ops/CI credential capable
 * of CREATE DATABASE, distinct from and never derived from any service's own
 * `DATABASE_URL`. Dev default matches the local Postgres container
 * (localhost:5435, civitas_admin — see infra/docker-compose.yml); override via
 * `PROVISIONING_RUNNER_DSN`/`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` for other
 * environments.
 */
function createRunnerConn() {
  const dsn = process.env.PROVISIONING_RUNNER_DSN ?? buildDevDsn();
  return createSqlClient(dsn, { max: 1 });
}

function buildDevDsn() {
  const host = process.env.PGHOST ?? "localhost";
  const port = process.env.PGPORT ?? "5435";
  const user = process.env.PGUSER ?? "civitas_admin";
  const password = process.env.PGPASSWORD ?? process.env.POSTGRES_ADMIN_PASSWORD ?? "";
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/postgres`;
}

console.log(`\n── Provisioning silo tenant ${tenantId} → DB ${dbName} ──\n`);

const runnerConn = createRunnerConn();
let result;
try {
  result = await provisionSiloDatabase(tenantId, dbName, [], runnerConn, { reposRoot: ROOT });
} finally {
  await runnerConn.end({ timeout: 5 }).catch(() => undefined);
}

const applied = result.steps.filter((s) => s.ok && !s.detail?.includes("idempotent")).length;
const idem = result.steps.filter((s) => s.ok && s.detail?.includes("idempotent")).length;
const errors = result.steps.filter((s) => !s.ok).length;

console.log(`\n── Summary ──`);
console.log(`DB        : ${dbName}`);
console.log(`Applied   : ${applied}`);
console.log(`Idempotent: ${idem}`);
console.log(`Errors    : ${errors}`);
if (result.status === "failed") {
  console.error(`\n[ERR] failed at step ${result.failingStep}: ${result.error}`);
  process.exit(1);
}
console.log(`\n✓ Silo tenant ${tenantId} provisioned. Set TENANT_SILO_IDS += ${tenantId} and`);
console.log(`  TENANT_SILO_DSN_TEMPLATE so services route it to ${dbName}.`);
