import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditObservations, type ObservationRow, type ObservationInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findObservationById(id: string): Promise<ObservationRow | null> {
  const rows = await db.select().from(auditObservations).where(eq(auditObservations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findObservationByIdTx(tx: Writer, id: string): Promise<ObservationRow | null> {
  const rows = await (tx as typeof db).select().from(auditObservations).where(eq(auditObservations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertObservation(tx: Writer, row: ObservationInsert): Promise<void> {
  await tx.insert(auditObservations).values(row);
}

export async function updateObservation(tx: Writer, id: string, patch: Partial<ObservationInsert>): Promise<void> {
  await tx.update(auditObservations).set({ ...patch, updatedAt: new Date() }).where(eq(auditObservations.id, id));
}
