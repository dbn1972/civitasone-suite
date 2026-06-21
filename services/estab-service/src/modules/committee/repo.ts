import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabCommittees, estabMeetings, estabResolutions, estabCompliance } from "./schema.js";
import type { CommitteeInsert, MeetingInsert, MeetingRow, ResolutionInsert, ComplianceRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findMeetingsByCommittee(committeeId: string, tenantId: string): Promise<MeetingRow[]> {
  return db.select().from(estabMeetings)
    .where(and(eq(estabMeetings.committeeId, committeeId), eq(estabMeetings.tenantId, tenantId)));
}

export async function listMeetingsByTenant(tenantId: string, limit: number): Promise<MeetingRow[]> {
  return db.select().from(estabMeetings).where(eq(estabMeetings.tenantId, tenantId)).limit(limit);
}

export async function findMeetingById(id: string, tenantId: string): Promise<MeetingRow | null> {
  const rows = await db.select().from(estabMeetings)
    .where(and(eq(estabMeetings.id, id), eq(estabMeetings.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function countResolutions(tx: Writer, meetingId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(estabResolutions).where(eq(estabResolutions.meetingId, meetingId));
  return rows.length;
}

export async function insertCommittee(tx: Writer, row: CommitteeInsert): Promise<void> {
  await tx.insert(estabCommittees).values(row);
}

export async function insertMeeting(tx: Writer, row: MeetingInsert): Promise<void> {
  await tx.insert(estabMeetings).values(row);
}

export async function insertResolution(tx: Writer, row: ResolutionInsert): Promise<void> {
  await tx.insert(estabResolutions).values(row);
}

export async function updateMeeting(tx: Writer, id: string, patch: Partial<MeetingInsert>): Promise<void> {
  await tx.update(estabMeetings).set({ ...patch, updatedAt: new Date() }).where(eq(estabMeetings.id, id));
}

export async function listComplianceItems(tenantId: string, limit: number): Promise<ComplianceRow[]> {
  return db.select().from(estabCompliance)
    .where(eq(estabCompliance.tenantId, tenantId))
    .limit(limit);
}
