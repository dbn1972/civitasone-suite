import { and, eq, sql, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsNominations, hrmsTrainings, type NominationRow } from "../training/schema.js";
import {
  trainingSessions, sessionAttendance,
  type TrainingSessionRow, type SessionAttendanceRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── sessions ──────────────────────────────────────────────────────
export async function insertSession(tx: Writer, row: typeof trainingSessions.$inferInsert): Promise<TrainingSessionRow> {
  const rows = await tx.insert(trainingSessions).values(row).returning();
  return rows[0]!;
}
export async function getSession(tenantId: string, id: string): Promise<TrainingSessionRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(trainingSessions)
    .where(and(eq(trainingSessions.id, id), eq(trainingSessions.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function listSessions(tenantId: string, trainingId: string): Promise<TrainingSessionRow[]> {
  return scopedRead((t) => t.select().from(trainingSessions)
    .where(and(eq(trainingSessions.tenantId, tenantId), eq(trainingSessions.trainingId, trainingId))));
}

// ── nominations (approval workflow) ───────────────────────────────
export async function getNomination(tenantId: string, id: string): Promise<NominationRow | undefined> {
  const rows = await scopedRead((t) => t.select().from(hrmsNominations)
    .where(and(eq(hrmsNominations.id, id), eq(hrmsNominations.tenantId, tenantId))).limit(1));
  return rows[0];
}
export async function getTraining(tenantId: string, id: string) {
  const rows = await scopedRead((t) => t.select().from(hrmsTrainings)
    .where(and(eq(hrmsTrainings.id, id), eq(hrmsTrainings.tenantId, tenantId))).limit(1));
  return rows[0];
}
/** Count nominations already approved (holding a seat) for a session. */
export async function countApprovedForSession(tenantId: string, sessionId: string): Promise<number> {
  const rows = await scopedRead((t) => t
    .select({ n: sql<number>`count(*)::int` })
    .from(hrmsNominations)
    .where(and(
      eq(hrmsNominations.tenantId, tenantId),
      eq(hrmsNominations.sessionId, sessionId),
      eq(hrmsNominations.status, "approved"),
    )));
  return rows[0]?.n ?? 0;
}
export async function countWaitlistedForSession(tenantId: string, sessionId: string): Promise<number> {
  const rows = await scopedRead((t) => t
    .select({ n: sql<number>`count(*)::int` })
    .from(hrmsNominations)
    .where(and(
      eq(hrmsNominations.tenantId, tenantId),
      eq(hrmsNominations.sessionId, sessionId),
      eq(hrmsNominations.status, "waitlisted"),
    )));
  return rows[0]?.n ?? 0;
}
export async function listWaitlisted(tenantId: string, sessionId: string): Promise<Array<{ id: string; waitlistPosition: number | null }>> {
  return scopedRead((t) => t
    .select({ id: hrmsNominations.id, waitlistPosition: hrmsNominations.waitlistPosition })
    .from(hrmsNominations)
    .where(and(
      eq(hrmsNominations.tenantId, tenantId),
      eq(hrmsNominations.sessionId, sessionId),
      eq(hrmsNominations.status, "waitlisted"),
    )));
}

/**
 * Approve a nomination into a session seat or the waitlist. Guarded to open
 * states (nominated) so a re-decide is a no-op. Returns the updated row or null.
 */
export async function decideNomination(
  tx: Writer, tenantId: string, id: string, actorId: string,
  data: { status: "approved" | "waitlisted"; sessionId: string; waitlistPosition: number | null },
): Promise<NominationRow | null> {
  const rows = await tx.update(hrmsNominations)
    .set({
      status: data.status,
      sessionId: data.sessionId,
      waitlistPosition: data.waitlistPosition,
      approvedBy: actorId,
      decidedAt: new Date(),
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsNominations.version} + 1`,
    })
    .where(and(
      eq(hrmsNominations.id, id),
      eq(hrmsNominations.tenantId, tenantId),
      inArray(hrmsNominations.status, ["nominated"]),
    ))
    .returning();
  return rows[0] ?? null;
}

/** Reject a nominated/waitlisted nomination. */
export async function rejectNomination(
  tx: Writer, tenantId: string, id: string, actorId: string,
): Promise<NominationRow | null> {
  const rows = await tx.update(hrmsNominations)
    .set({
      status: "rejected", approvedBy: actorId, decidedAt: new Date(),
      updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsNominations.version} + 1`,
    })
    .where(and(
      eq(hrmsNominations.id, id),
      eq(hrmsNominations.tenantId, tenantId),
      inArray(hrmsNominations.status, ["nominated", "waitlisted", "approved"]),
    ))
    .returning();
  return rows[0] ?? null;
}

/** Promote a specific waitlisted nomination to an approved seat. */
export async function promoteNomination(
  tx: Writer, tenantId: string, id: string, actorId: string,
): Promise<NominationRow | null> {
  const rows = await tx.update(hrmsNominations)
    .set({
      status: "approved", waitlistPosition: null, approvedBy: actorId, decidedAt: new Date(),
      updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsNominations.version} + 1`,
    })
    .where(and(
      eq(hrmsNominations.id, id),
      eq(hrmsNominations.tenantId, tenantId),
      eq(hrmsNominations.status, "waitlisted"),
    ))
    .returning();
  return rows[0] ?? null;
}

// ── attendance ────────────────────────────────────────────────────
/** Upsert attendance for (session, employee). Returns the row. */
export async function upsertAttendance(
  tx: Writer, row: typeof sessionAttendance.$inferInsert,
): Promise<SessionAttendanceRow> {
  const rows = await tx.insert(sessionAttendance).values(row)
    .onConflictDoUpdate({
      target: [sessionAttendance.tenantId, sessionAttendance.sessionId, sessionAttendance.employeeId],
      set: { status: row.status ?? "present", markedBy: row.markedBy, markedAt: new Date() },
    })
    .returning();
  return rows[0]!;
}
export async function listAttendance(tenantId: string, sessionId: string): Promise<SessionAttendanceRow[]> {
  return scopedRead((t) => t.select().from(sessionAttendance)
    .where(and(eq(sessionAttendance.tenantId, tenantId), eq(sessionAttendance.sessionId, sessionId))));
}
