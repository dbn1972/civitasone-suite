/**
 * Provisioning_Actuator — privileged-runner-facing orchestration for silo tenant
 * database creation + migration (Req 3.1, 3.3, 3.6, 3.7).
 *
 * This module extracts the exact `CREATE DATABASE IF NOT EXISTS` + per-service
 * migration-directory-walk + `IF NOT EXISTS`-tolerant apply loop that used to
 * live only in `scripts/dev/provision-silo-tenant.mjs`, so the CLI script and
 * this actuator share ONE implementation and can never drift (task 7.5).
 *
 * Privilege boundary (Req 3.7): `provisionSiloDatabase` takes an injected
 * `runnerConn` — a privileged postgres-js `Sql` client supplied by the caller
 * (the CLI script's dev admin connection today; a `PROVISIONING_RUNNER_DSN`-
 * sourced connection from the worker's poll loop once task 7.7 wires this in).
 * It never reads `DATABASE_URL` or any other service's runtime connection
 * string itself — no DB_Backed_Service or its runtime identity needs
 * `CREATEDB` privileges in production.
 *
 * Resumability (Req 3.3, 3.6, 4.3): callers pass `alreadyApplied` — the
 * migration identifiers already confirmed applied on a prior attempt — and
 * `provisionSiloDatabase` computes `pendingMigrations(all, alreadyApplied)`
 * (domain.ts, task 7.1) before applying anything, so a resumed/retried call
 * re-applies only what has not already succeeded. Every migration file is
 * itself `CREATE ... IF NOT EXISTS`, so even re-applying an already-succeeded
 * migration (e.g. a resume racing a not-yet-persisted `appliedMigrations`
 * update) is a safe no-op rather than an error.
 */
import postgres from "postgres";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pendingMigrations } from "./domain.js";

/**
 * Every DB_Backed_Service whose migrations are applied into a silo tenant's
 * dedicated database (Option B: one physical DB hosts every service's pg
 * schema). Kept in sync with `scripts/dev/provision-silo-tenant.mjs` and
 * `scripts/dev/migrate-all.mjs`'s service lists — all three must name the
 * same 31 DB-backed services.
 */
export const SERVICES: readonly string[] = [
  "admin-service", "analytics-service", "asset-service", "audit-service",
  "billing-service", "citizen-service", "contract-service", "crm-service",
  "estab-service", "finance-service", "grant-service", "helpdesk-service",
  "hrms-service", "identity-service", "install-service", "inventory-service",
  "knowledge-service", "legal-service", "location-service", "notification-service",
  "payroll-service", "plugin-service", "policy-service", "procurement-service",
  "project-service", "report-service", "stock-service", "telephony-service",
  "tenant-service", "theme-service", "workflow-service",
];

/** One migration file, addressed by the service it belongs to. */
export interface MigrationStep {
  service: string;
  file: string;
}

export interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface ActuatorResult {
  status: "ready" | "failed";
  steps: StepResult[];
  /** Migration identifiers (`"<service>/<file>"`) confirmed applied by this call. */
  appliedMigrations: string[];
  failingStep?: string;
  error?: string;
}

/** Migration-root lookup, overridable so tests can point at a fixture tree. */
export interface ProvisionSiloDatabaseOptions {
  /** Absolute path to the monorepo root containing each service's `migrations` dir. Defaults to this file's repo root. */
  reposRoot?: string;
}

// This file lives at services/install-service/{src,dist}/modules/provisioning/
// in both its TS source and compiled locations, so the same relative depth
// (5 levels up) reaches the monorepo root either way — no build-time constant.
// Exported so the worker poll loop (scheduler.ts, task 7.7) can compute the
// same `requiredMigrations` list the CLI script/actuator use, without
// duplicating this path-resolution logic.
export const DEFAULT_ROOT = join(new URL(".", import.meta.url).pathname, "../../../../..");

/** `"<service>/<file>"` identifiers for every migration file across every DB_Backed_Service, in a stable order. */
export function listAllMigrations(reposRoot: string): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const service of SERVICES) {
    const dir = join(reposRoot, "services", service, "migrations");
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) steps.push({ service, file });
  }
  return steps;
}

function migrationId(step: MigrationStep): string {
  return `${step.service}/${step.file}`;
}

/**
 * `"<service>/<file>"` identifiers for every migration file across every
 * DB_Backed_Service (Req 3.8, 4.5) — the `requiredMigrations` list the worker
 * poll loop (scheduler.ts, task 7.7) diffs a completed run's `appliedMigrations`
 * against via `domain.ts`'s `migrationsConfirmed`/`canTransitionToReady` before
 * persisting a `ready` transition, so `ready` is only ever reached once every
 * required migration is actually confirmed applied — never inferred solely from
 * `provisionSiloDatabase`'s own `status` field.
 */
export function listAllMigrationIds(reposRoot: string): string[] {
  return listAllMigrations(reposRoot).map(migrationId);
}

/**
 * Create the tenant's dedicated database (idempotent) and apply every
 * DB_Backed_Service's migrations that are not already in `alreadyApplied`
 * (Req 3.3, 3.6). Runs entirely against the injected `runnerConn` — never
 * `DATABASE_URL` (Req 3.7).
 *
 * Mirrors `scripts/dev/provision-silo-tenant.mjs`'s proven behavior exactly:
 * a migration failure whose error text contains "already exists" (and not a
 * hard `ERROR`) is treated as an idempotent no-op rather than a failure, so
 * concurrently-applied or partially-applied migrations never block progress.
 * Any other error stops the walk and marks the record `failed` with the
 * failing step recorded (Req 4.1).
 */
export async function provisionSiloDatabase(
  tenantId: string,
  dbName: string,
  alreadyApplied: string[],
  runnerConn: postgres.Sql,
  options: ProvisionSiloDatabaseOptions = {},
): Promise<ActuatorResult> {
  const reposRoot = options.reposRoot ?? DEFAULT_ROOT;
  const steps: StepResult[] = [];
  const appliedMigrations: string[] = [...alreadyApplied];

  // 1) Create the database if it does not already exist (Req 3.3).
  try {
    const existing = await runnerConn.unsafe(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (Array.isArray(existing) && existing.length > 0) {
      steps.push({ step: "create_database", ok: true, detail: `already exists (tenant ${tenantId})` });
    } else {
      // Database names cannot be parameterized; dbName is derived internally
      // from the tenantId (see siloDbName in consumer.ts), never user input.
      await runnerConn.unsafe(`CREATE DATABASE ${dbName}`);
      steps.push({ step: "create_database", ok: true, detail: `created for tenant ${tenantId}` });
    }
  } catch (err) {
    const detail = errorDetail(err);
    return {
      status: "failed",
      steps: [...steps, { step: "create_database", ok: false, detail }],
      appliedMigrations,
      failingStep: "create_database",
      error: detail,
    };
  }

  // 2) Connect to the newly-created tenant database using the same privileged
  //    credentials as runnerConn, then walk + apply pending migrations (Req 3.3, 3.6).
  const all = listAllMigrations(reposRoot);
  const pending = pendingMigrations(all.map(migrationId), appliedMigrations)
    .map((id) => all.find((s) => migrationId(s) === id))
    .filter((s): s is MigrationStep => s !== undefined);

  const tenantConn = connectToDatabase(runnerConn, dbName);
  try {
    for (const step of pending) {
      const id = migrationId(step);
      const filePath = join(reposRoot, "services", step.service, "migrations", step.file);
      const sql = readFileSync(filePath, "utf8");
      try {
        await tenantConn.unsafe(sql);
        appliedMigrations.push(id);
        steps.push({ step: id, ok: true });
      } catch (err) {
        const detail = errorDetail(err);
        const idempotent = /already exists/i.test(detail) && !/ERROR:/.test(detail);
        if (idempotent) {
          appliedMigrations.push(id);
          steps.push({ step: id, ok: true, detail: "already applied (idempotent)" });
          continue;
        }
        return {
          status: "failed",
          steps: [...steps, { step: id, ok: false, detail }],
          appliedMigrations,
          failingStep: id,
          error: detail,
        };
      }
    }
  } finally {
    await tenantConn.end({ timeout: 5 }).catch(() => undefined);
  }

  return { status: "ready", steps, appliedMigrations };
}

/** Errors from postgres-js carry `.message`; fall back to String() for anything else. */
function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Open a second privileged connection to `dbName` reusing `runnerConn`'s host/
 * port/user/credentials — the same runner identity, just pointed at the
 * tenant's dedicated database instead of the maintenance (`postgres`) database
 * `runnerConn` is typically opened against.
 */
function connectToDatabase(runnerConn: postgres.Sql, dbName: string): postgres.Sql {
  const o = runnerConn.options;
  // postgres-js's ParsedOptions types `pass` as `null` (it's write-only in the
  // parsed shape) even though the runtime value is the actual credential —
  // read it through an untyped view rather than widening the public Sql type.
  const pass = (o as unknown as { pass?: string }).pass;
  return postgres({
    host: o.host[0],
    port: o.port[0],
    user: o.user,
    pass,
    database: dbName,
    max: 1,
    ssl: o.ssl,
  });
}
