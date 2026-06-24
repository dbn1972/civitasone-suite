import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsDeputations, type DeputationRow, type DeputationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertDeputation(tx: Writer, row: DeputationInsert): Promise<void> {
  await tx.insert(hrmsDeputations).values(row);
}

export async function findById(tenantId: string, id: string): Promise<DeputationRow | null> {
  const rows = await db.select().from(hrmsDeputations)
    .where(and(eq(hrmsDeputations.tenantId, tenantId), eq(hrmsDeputations.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function findActiveByEmployee(tenantId: string, employeeId: string): Promise<DeputationRow | null> {
  const rows = await db.select().from(hrmsDeputations)
    .where(and(
      eq(hrmsDeputations.tenantId, tenantId),
      eq(hrmsDeputations.employeeId, employeeId),
      eq(hrmsDeputations.status, "active"),
    )).limit(1);
  return rows[0] ?? null;
}

export async function listByEmployee(tenantId: string, employeeId: string): Promise<DeputationRow[]> {
  return db.select().from(hrmsDeputations)
    .where(and(eq(hrmsDeputations.tenantId, tenantId), eq(hrmsDeputations.employeeId, employeeId)))
    .orderBy(asc(hrmsDeputations.tenureFrom));
}

/**
 * Close (repatriate / cancel) a deputation with an optimistic-lock guard on the
 * `version` column so two concurrent repatriations cannot both fire.
 */
export async function closeDeputation(
  tx: Writer, tenantId: string, id: string,
  patch: Partial<DeputationInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsDeputations)
    .set({ ...patch, version: sql`${hrmsDeputations.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsDeputations.tenantId, tenantId),
      eq(hrmsDeputations.id, id),
      eq(hrmsDeputations.version, expectedVersion),
    ));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "deputation was modified by another request; reload and retry");
  }
}
