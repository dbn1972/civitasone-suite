import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenRtiRequests, citizenRtiResponses, citizenRtiAppeals,
  type RtiRow, type RtiInsert, type RtiResponseInsert, type RtiAppealInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRtiById(id: string): Promise<RtiRow | null> {
  const rows = await db.select().from(citizenRtiRequests).where(eq(citizenRtiRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

/** P1-2: scope by (id AND tenantId) so a forged foreign id cannot be read/mutated. */
export async function findRtiByIdTx(tx: Writer, id: string, tenantId: string): Promise<RtiRow | null> {
  const rows = await (tx as typeof db).select().from(citizenRtiRequests)
    .where(and(eq(citizenRtiRequests.id, id), eq(citizenRtiRequests.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertRti(tx: Writer, row: RtiInsert): Promise<void> {
  await tx.insert(citizenRtiRequests).values(row);
}

export async function updateRti(tx: Writer, id: string, tenantId: string, patch: Partial<RtiInsert>): Promise<void> {
  // P1-2: tenant-scoped update prevents cross-tenant writes via a forged id.
  await tx.update(citizenRtiRequests).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenRtiRequests.id, id), eq(citizenRtiRequests.tenantId, tenantId)));
}

export async function insertResponse(tx: Writer, row: RtiResponseInsert): Promise<void> {
  await tx.insert(citizenRtiResponses).values(row);
}

export async function insertAppeal(tx: Writer, row: RtiAppealInsert): Promise<void> {
  await tx.insert(citizenRtiAppeals).values(row);
}

export async function listResponses(rtiId: string) {
  return db.select().from(citizenRtiResponses).where(eq(citizenRtiResponses.rtiId, rtiId));
}

export async function listAppeals(rtiId: string) {
  return db.select().from(citizenRtiAppeals).where(eq(citizenRtiAppeals.rtiId, rtiId));
}

export async function listRtiByTenant(tenantId: string, limit: number): Promise<RtiRow[]> {
  return db.select().from(citizenRtiRequests).where(eq(citizenRtiRequests.tenantId, tenantId)).limit(limit);
}
