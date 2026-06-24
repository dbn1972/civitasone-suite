import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsDisciplinaryCases, hrmsDisciplinaryEvents, hrmsSuspensions,
  type DisciplinaryCaseRow, type DisciplinaryCaseInsert,
  type SuspensionRow, type SuspensionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertCase(tx: Writer, row: DisciplinaryCaseInsert): Promise<void> {
  await tx.insert(hrmsDisciplinaryCases).values(row);
}

export async function findCase(tenantId: string, id: string): Promise<DisciplinaryCaseRow | null> {
  const rows = await db.select().from(hrmsDisciplinaryCases)
    .where(and(eq(hrmsDisciplinaryCases.tenantId, tenantId), eq(hrmsDisciplinaryCases.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listCasesByEmployee(tenantId: string, employeeId: string): Promise<DisciplinaryCaseRow[]> {
  return db.select().from(hrmsDisciplinaryCases)
    .where(and(eq(hrmsDisciplinaryCases.tenantId, tenantId), eq(hrmsDisciplinaryCases.employeeId, employeeId)))
    .orderBy(desc(hrmsDisciplinaryCases.createdAt));
}

export async function updateCase(
  tx: Writer, tenantId: string, id: string, patch: Partial<DisciplinaryCaseInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsDisciplinaryCases)
    .set({ ...patch, version: sql`${hrmsDisciplinaryCases.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsDisciplinaryCases.tenantId, tenantId),
      eq(hrmsDisciplinaryCases.id, id),
      eq(hrmsDisciplinaryCases.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "case was modified by another request; reload and retry");
  }
}

export async function appendEvent(
  tx: Writer, row: {
    tenantId: string; caseId: string; fromStatus: string | null; toStatus: string;
    action: string; notes: string | null; actorId: string;
  },
): Promise<void> {
  await tx.insert(hrmsDisciplinaryEvents).values(row);
}

export async function listEvents(tenantId: string, caseId: string) {
  return db.select().from(hrmsDisciplinaryEvents)
    .where(and(eq(hrmsDisciplinaryEvents.tenantId, tenantId), eq(hrmsDisciplinaryEvents.caseId, caseId)))
    .orderBy(asc(hrmsDisciplinaryEvents.occurredAt));
}

// ---------------- suspensions ----------------
export async function insertSuspension(tx: Writer, row: SuspensionInsert): Promise<void> {
  await tx.insert(hrmsSuspensions).values(row);
}

export async function findSuspension(tenantId: string, id: string): Promise<SuspensionRow | null> {
  const rows = await db.select().from(hrmsSuspensions)
    .where(and(eq(hrmsSuspensions.tenantId, tenantId), eq(hrmsSuspensions.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listSuspensionsByEmployee(tenantId: string, employeeId: string): Promise<SuspensionRow[]> {
  return db.select().from(hrmsSuspensions)
    .where(and(eq(hrmsSuspensions.tenantId, tenantId), eq(hrmsSuspensions.employeeId, employeeId)))
    .orderBy(desc(hrmsSuspensions.fromDate));
}

export async function updateSuspension(
  tx: Writer, tenantId: string, id: string, patch: Partial<SuspensionInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsSuspensions)
    .set({ ...patch, version: sql`${hrmsSuspensions.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsSuspensions.tenantId, tenantId),
      eq(hrmsSuspensions.id, id),
      eq(hrmsSuspensions.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "suspension was modified by another request; reload and retry");
  }
}

/**
 * Returns the set of employee IDs (within a tenant) that currently have an
 * ACTIVE pay-suspension. Used by the payroll-input projection to flag
 * pay-suspended employees so payroll can apply subsistence allowance.
 */
export async function activePaySuspendedEmployeeIds(tenantId: string): Promise<Map<string, { subsistencePct: string }>> {
  const rows = await db.select({
    employeeId: hrmsSuspensions.employeeId,
    subsistencePct: hrmsSuspensions.subsistencePct,
  }).from(hrmsSuspensions)
    .where(and(
      eq(hrmsSuspensions.tenantId, tenantId),
      eq(hrmsSuspensions.status, "active"),
      eq(hrmsSuspensions.paySuspended, true)));
  const m = new Map<string, { subsistencePct: string }>();
  for (const r of rows) m.set(r.employeeId, { subsistencePct: r.subsistencePct });
  return m;
}
