import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenGrievances, citizenGrievanceActions, citizenEscalations,
  type GrievanceRow, type GrievanceInsert, type GrievanceActionInsert, type EscalationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findGrievanceById(id: string): Promise<GrievanceRow | null> {
  const rows = await db.select().from(citizenGrievances).where(eq(citizenGrievances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findGrievanceByIdTx(tx: Writer, id: string): Promise<GrievanceRow | null> {
  const rows = await (tx as typeof db).select().from(citizenGrievances).where(eq(citizenGrievances.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listGrievancesByCitizen(tenantId: string, citizenId: string): Promise<GrievanceRow[]> {
  return db.select().from(citizenGrievances)
    .where(and(eq(citizenGrievances.tenantId, tenantId), eq(citizenGrievances.citizenId, citizenId)));
}

export async function listGrievancesByTenant(tenantId: string, limit: number, offset: number): Promise<GrievanceRow[]> {
  return db.select().from(citizenGrievances)
    .where(eq(citizenGrievances.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function listActions(grievanceId: string) {
  return db.select().from(citizenGrievanceActions).where(eq(citizenGrievanceActions.grievanceId, grievanceId));
}

export async function insertGrievance(tx: Writer, row: GrievanceInsert): Promise<void> {
  await tx.insert(citizenGrievances).values(row);
}

export async function updateGrievance(tx: Writer, id: string, patch: Partial<GrievanceInsert>): Promise<void> {
  await tx.update(citizenGrievances).set({ ...patch, updatedAt: new Date() }).where(eq(citizenGrievances.id, id));
}

export async function insertAction(tx: Writer, row: GrievanceActionInsert): Promise<void> {
  await tx.insert(citizenGrievanceActions).values(row);
}

export async function insertEscalation(tx: Writer, row: EscalationInsert): Promise<void> {
  await tx.insert(citizenEscalations).values(row);
}
