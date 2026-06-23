import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  physicalVerifications, physicalVerificationItems, writeoffApprovals,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type VerificationInsert = typeof physicalVerifications.$inferInsert;
type ItemInsert = typeof physicalVerificationItems.$inferInsert;
type WriteoffInsert = typeof writeoffApprovals.$inferInsert;

export async function insertVerification(tx: Writer, row: VerificationInsert): Promise<void> {
  await tx.insert(physicalVerifications).values(row);
}

export async function insertVerificationItem(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(physicalVerificationItems).values(row);
}

export async function findVerificationById(id: string, tenantId: string) {
  const rows = await db.select().from(physicalVerifications)
    .where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listVerifications(tenantId: string, limit = 50) {
  return db.select().from(physicalVerifications)
    .where(eq(physicalVerifications.tenantId, tenantId)).limit(limit);
}

export async function updateVerification(tx: Writer, id: string, patch: Partial<VerificationInsert>): Promise<void> {
  await tx.update(physicalVerifications).set({ ...patch, updatedAt: new Date() }).where(eq(physicalVerifications.id, id));
}

export async function insertWriteoffRequest(tx: Writer, row: WriteoffInsert): Promise<void> {
  await tx.insert(writeoffApprovals).values(row);
}

export async function findApprovedWriteoff(tenantId: string, assetId: string) {
  const rows = await db.select().from(writeoffApprovals).where(and(
    eq(writeoffApprovals.tenantId, tenantId),
    eq(writeoffApprovals.assetId, assetId),
    eq(writeoffApprovals.status, "approved"),
  )).limit(1);
  return rows[0] ?? null;
}

export async function approveWriteoff(tx: Writer, id: string, approvedBy: string): Promise<void> {
  await tx.update(writeoffApprovals).set({
    status: "approved", approvedBy, approvedAt: new Date(),
  }).where(eq(writeoffApprovals.id, id));
}
