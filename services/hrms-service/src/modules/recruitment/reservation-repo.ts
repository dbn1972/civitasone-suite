import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsReservationRosters, type ReservationRosterRow, type ReservationRosterInsert } from "./reservation-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affectedRows(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function findByJob(tenantId: string, jobOpeningId: string): Promise<ReservationRosterRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsReservationRosters)
    .where(and(eq(hrmsReservationRosters.tenantId, tenantId), eq(hrmsReservationRosters.jobOpeningId, jobOpeningId))).limit(1));
  return rows[0] ?? null;
}

export async function insertRoster(tx: Writer, row: ReservationRosterInsert): Promise<void> {
  await tx.insert(hrmsReservationRosters).values(row);
}

export async function updateRoster(tx: Writer, tenantId: string, jobOpeningId: string, patch: Partial<ReservationRosterInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsReservationRosters)
    .set({ ...patch, version: sql`${hrmsReservationRosters.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsReservationRosters.tenantId, tenantId), eq(hrmsReservationRosters.jobOpeningId, jobOpeningId), eq(hrmsReservationRosters.version, expectedVersion)));
  if (affectedRows(res) === 0) throw new HttpError(409, "VERSION_CONFLICT", "roster was modified by another request; reload and retry");
}
