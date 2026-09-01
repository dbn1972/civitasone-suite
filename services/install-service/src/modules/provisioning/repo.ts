import { eq, and, desc, inArray, lt, or } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { siloProvisions } from "./schema.js";
import type { SiloProvisionRow, SiloProvisionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * TENANT-SCOPING FIX (deep-verification, 2026-08-27): install.silo_provisions
 * has FORCE ROW LEVEL SECURITY (`tenant_id = install.current_tenant_id()`,
 * migration 0006) and install_svc is explicitly NOBYPASSRLS (see privilegedDb
 * below) -- there is no escape hatch for the ordinary tenant-scoped `db`.
 * wrapWithTenantGuc only injects the app.tenant_id GUC around
 * db.transaction() calls, so a bare db.select() never gets it. This is a
 * DIFFERENT function from findById/list further down (removed by this fix --
 * see git history if you need the old signatures): those were called
 * directly from the HTTP routes (GET /v1/install/silo-provisions[/:id]) with
 * NO tenant filter applied ANYWHERE -- not app-level, not via this wrapper --
 * so today they return zero rows for every caller (broken but not leaking);
 * the moment someone "fixes" that by only adding this GUC wrapper without
 * ALSO scoping the query to the caller's own tenant, it becomes a real
 * cross-tenant data leak (every tenant's provisioning records, to any
 * READER_ROLES caller). Fixed both at once below.
 */
async function tenantScoped<T>(tenantId: string, fn: (tx: Writer) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction((tx) => fn(tx as unknown as Writer)));
}

export async function findByTenantTx(tx: Writer, tenantId: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions)
    .where(eq(siloProvisions.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

/** Tenant-scoped single-record lookup for the GET /v1/install/silo-provisions/:id route. */
export async function findByIdForTenant(id: string, tenantId: string): Promise<SiloProvisionRow | null> {
  return tenantScoped(tenantId, async (tx) => {
    const rows = await (tx as unknown as typeof db)
      .select().from(siloProvisions)
      .where(and(eq(siloProvisions.id, id), eq(siloProvisions.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Tenant-scoped list for the GET /v1/install/silo-provisions route. */
export async function listForTenant(tenantId: string, limit: number, status?: string): Promise<SiloProvisionRow[]> {
  return tenantScoped(tenantId, async (tx) => {
    const rows = await (tx as unknown as typeof db)
      .select().from(siloProvisions)
      .where(eq(siloProvisions.tenantId, tenantId))
      .orderBy(desc(siloProvisions.requestedAt))
      .limit(limit);
    return status ? rows.filter((r) => r.status === status) : rows;
  });
}

export async function insert(tx: Writer, row: SiloProvisionInsert): Promise<void> {
  await tx.insert(siloProvisions).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SiloProvisionInsert>): Promise<void> {
  await tx.update(siloProvisions).set({ ...patch, updatedAt: new Date() }).where(eq(siloProvisions.id, id));
}

export async function findByIdTenantTx(tx: Writer, id: string, tenantId: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions)
    .where(and(eq(siloProvisions.id, id), eq(siloProvisions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * A privileged (BYPASSRLS-capable) Drizzle instance bound to the poll loop's
 * `PROVISIONING_RUNNER_DSN` connection.
 *
 * `install.silo_provisions` is RLS-enforced (`tenant_id = install.
 * current_tenant_id()`, `FORCE ROW LEVEL SECURITY`, and `install_svc` is
 * `NOBYPASSRLS`). The poll loop's initial scan must find `requested`/
 * `failed`/stale-`provisioning` records ACROSS EVERY TENANT before it even
 * knows which tenant(s) own them — there is no single tenant's `app.tenant_id`
 * GUC to set for that scan, so the ordinary tenant-scoped `db` can never see
 * any row here regardless of tenant context.
 *
 * `findPollable` therefore runs against the same privileged `runnerConn` the
 * actuator already uses for database creation/migration (Req 3.7's
 * `PROVISIONING_RUNNER_DSN`, not any service's `DATABASE_URL`) — the ONE
 * genuinely cross-tenant query in this file. Once a candidate record's
 * `tenantId` is known (after the scan), the claim/update steps use the
 * ordinary tenant-scoped `db` wrapped in `runWithTenant(record.tenantId, …)`
 * (scheduler.ts), exactly like every other consumer/route in the fleet.
 */
function privilegedDb(runnerConn: postgres.Sql): PostgresJsDatabase<{ siloProvisions: typeof siloProvisions }> {
  return drizzle(runnerConn, { schema: { siloProvisions } });
}

/**
 * Silo_Provisioning_Record candidates for the worker poll loop (task 7.7,
 * Req 3.2, error-handling table "Actuator crashes/restarts mid-migration"):
 * every `requested`/`failed` record, plus any `provisioning` record whose
 * `updatedAt` is older than `staleBeforeMs` — treated as an interrupted/
 * crashed runner attempt safely resumable via Property 5's idempotency.
 *
 * Genuinely cross-tenant by design — runs against the privileged
 * `runnerConn` (see `privilegedDb` above), never the tenant-scoped `db`,
 * since no single tenant's GUC applies to this scan.
 */
export async function findPollable(runnerConn: postgres.Sql, staleBefore: Date, limit: number): Promise<SiloProvisionRow[]> {
  return privilegedDb(runnerConn).select().from(siloProvisions)
    .where(or(
      inArray(siloProvisions.status, ["requested", "failed"]),
      and(eq(siloProvisions.status, "provisioning"), lt(siloProvisions.updatedAt, staleBefore)),
    ))
    .orderBy(siloProvisions.requestedAt)
    .limit(limit);
}

/** Read a single record by id, inside a transaction (used by the poll loop's claim step). */
export async function findByIdTx(tx: Writer, id: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions).where(eq(siloProvisions.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Optimistic-locked claim: transition a Silo_Provisioning_Record to
 * `provisioning` (Req 3.2 — before any I/O), only when its `version` still
 * matches `expectedVersion`. Returns `false` (no rows affected) when another
 * worker tick already claimed the same record between the poll scan and this
 * call — the caller skips the record rather than double-processing it, so
 * concurrent worker instances never race on the same tenant's provisioning
 * attempt.
 *
 * Once `findPollable`'s cross-tenant scan has identified a record, its
 * `tenantId` is known — the caller (scheduler.ts) wraps this in
 * `runWithTenant(record.tenantId, …)` around a normal `db.transaction()`, so
 * `tx` here is tenant-scoped exactly like every other consumer's writes; no
 * privileged connection is needed for a single already-identified tenant's row.
 */
export async function claimProvisioning(
  tx: Writer,
  id: string,
  expectedVersion: number,
  updatedBy: string,
  runnerStartedAt: Date,
): Promise<boolean> {
  const rows = await (tx as typeof db)
    .update(siloProvisions)
    .set({ status: "provisioning", runnerStartedAt, updatedAt: new Date(), updatedBy, version: expectedVersion + 1 })
    .where(and(eq(siloProvisions.id, id), eq(siloProvisions.version, expectedVersion)))
    .returning({ id: siloProvisions.id });
  return rows.length > 0;
}
