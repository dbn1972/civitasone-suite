import { eq, and, desc, inArray, lt, or } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { siloProvisions } from "./schema.js";
import type { SiloProvisionRow, SiloProvisionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenantTx(tx: Writer, tenantId: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions)
    .where(eq(siloProvisions.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<SiloProvisionRow | null> {
  const rows = await db.select().from(siloProvisions).where(eq(siloProvisions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function list(limit: number, status?: string): Promise<SiloProvisionRow[]> {
  const rows = await db.select().from(siloProvisions).orderBy(desc(siloProvisions.requestedAt)).limit(limit);
  return status ? rows.filter((r) => r.status === status) : rows;
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
 * Silo_Provisioning_Record candidates for the worker poll loop (task 7.7,
 * Req 3.2, error-handling table "Actuator crashes/restarts mid-migration"):
 * every `requested`/`failed` record, plus any `provisioning` record whose
 * `updatedAt` is older than `staleBeforeMs` — treated as an interrupted/
 * crashed runner attempt safely resumable via Property 5's idempotency.
 * Read outside a transaction (the scheduler claims one record at a time inside
 * its own tx via `findByIdTx` + an optimistic `version` check before acting).
 */
export async function findPollable(staleBefore: Date, limit: number): Promise<SiloProvisionRow[]> {
  return db.select().from(siloProvisions)
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
