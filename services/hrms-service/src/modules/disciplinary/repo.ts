import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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

export async function listCasesByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<DisciplinaryCaseRow[]> {
  return db.select().from(hrmsDisciplinaryCases)
    .where(and(eq(hrmsDisciplinaryCases.tenantId, tenantId), eq(hrmsDisciplinaryCases.employeeId, employeeId)))
    .orderBy(desc(hrmsDisciplinaryCases.createdAt))
    .limit(limit);
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

/**
 * Guarded status transition for a disciplinary case (mirrors lifecycle's
 * `transitionTransfer`). Only flips status when the current status is in
 * `from`; bumps version + updatedAt. Returns the updated row, or null when the
 * guard rejected (wrong state / not found / wrong tenant). Used by the eOffice
 * decision consumer to apply an approval/rejection idempotently and
 * tenant-safely without an optimistic-version round-trip.
 */
export async function transitionCase(
  tx: Writer, tenantId: string, id: string, actorId: string,
  opts: { from: string[]; to: string; set?: Partial<DisciplinaryCaseInsert> },
): Promise<DisciplinaryCaseRow | null> {
  const rows = await tx.update(hrmsDisciplinaryCases)
    .set({
      ...opts.set,
      status: opts.to,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsDisciplinaryCases.version} + 1`,
    })
    .where(and(
      eq(hrmsDisciplinaryCases.tenantId, tenantId),
      eq(hrmsDisciplinaryCases.id, id),
      inArray(hrmsDisciplinaryCases.status, opts.from)))
    .returning();
  return rows[0] ?? null;
}

export async function appendEvent(
  tx: Writer, row: {
    tenantId: string; caseId: string; fromStatus: string | null; toStatus: string;
    action: string; notes: string | null; actorId: string;
  },
): Promise<void> {
  await tx.insert(hrmsDisciplinaryEvents).values(row);
}

export async function listEvents(tenantId: string, caseId: string, limit = 500) {
  return db.select().from(hrmsDisciplinaryEvents)
    .where(and(eq(hrmsDisciplinaryEvents.tenantId, tenantId), eq(hrmsDisciplinaryEvents.caseId, caseId)))
    .orderBy(asc(hrmsDisciplinaryEvents.occurredAt))
    .limit(limit);
}

// ---------------- suspensions ----------------

/** True if the employee already has an ACTIVE suspension in this tenant. */
export async function hasActiveSuspension(tenantId: string, employeeId: string): Promise<boolean> {
  const rows = await db.select({ id: hrmsSuspensions.id }).from(hrmsSuspensions)
    .where(and(
      eq(hrmsSuspensions.tenantId, tenantId),
      eq(hrmsSuspensions.employeeId, employeeId),
      eq(hrmsSuspensions.status, "active")))
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert a suspension. H1: an employee may have at most ONE active suspension
 * (deterministic subsistence%). The DB partial unique index
 * `hrms_susp_one_active_uq` is the backstop; a 23505 (unique violation) is
 * surfaced as a 409 so a racing duplicate is rejected rather than silently
 * creating nondeterministic state.
 */
export async function insertSuspension(tx: Writer, row: SuspensionInsert): Promise<void> {
  try {
    await tx.insert(hrmsSuspensions).values(row);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23505") {
      throw new HttpError(
        409, "ACTIVE_SUSPENSION_EXISTS",
        "employee already has an active suspension; revoke it before creating another",
      );
    }
    throw e;
  }
}

export async function findSuspension(tenantId: string, id: string): Promise<SuspensionRow | null> {
  const rows = await db.select().from(hrmsSuspensions)
    .where(and(eq(hrmsSuspensions.tenantId, tenantId), eq(hrmsSuspensions.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listSuspensionsByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<SuspensionRow[]> {
  return db.select().from(hrmsSuspensions)
    .where(and(eq(hrmsSuspensions.tenantId, tenantId), eq(hrmsSuspensions.employeeId, employeeId)))
    .orderBy(desc(hrmsSuspensions.fromDate))
    .limit(limit);
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
      eq(hrmsSuspensions.paySuspended, true)))
    // Deterministic regardless of any (now-prevented) duplicate active rows:
    // order by employee then most-recent fromDate, then id, so the Map's
    // last-write-wins picks a stable subsistence% even as a defensive backstop.
    .orderBy(asc(hrmsSuspensions.employeeId), asc(hrmsSuspensions.fromDate), asc(hrmsSuspensions.id))
    .limit(500);
  const m = new Map<string, { subsistencePct: string }>();
  for (const r of rows) m.set(r.employeeId, { subsistencePct: r.subsistencePct });
  return m;
}
