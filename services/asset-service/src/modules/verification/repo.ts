import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  physicalVerifications, physicalVerificationItems, writeoffApprovals,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type VerificationInsert = typeof physicalVerifications.$inferInsert;
type ItemInsert = typeof physicalVerificationItems.$inferInsert;
type WriteoffInsert = typeof writeoffApprovals.$inferInsert;
type WriteoffRow = typeof writeoffApprovals.$inferSelect;

export async function insertVerification(tx: Writer, row: VerificationInsert): Promise<void> {
  await tx.insert(physicalVerifications).values(row);
}

export async function insertVerificationItem(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(physicalVerificationItems).values(row);
}

export async function findVerificationById(id: string, tenantId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(physicalVerifications)
    .where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listVerifications(tenantId: string, limit = 50) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(physicalVerifications)
    .where(eq(physicalVerifications.tenantId, tenantId)).limit(limit));
}

// P0-1: tenant-scoped update — id alone would let one tenant mutate another's verification.
export async function updateVerification(tx: Writer, id: string, tenantId: string, patch: Partial<VerificationInsert>): Promise<void> {
  await tx.update(physicalVerifications).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId)));
}

export async function insertWriteoffRequest(tx: Writer, row: WriteoffInsert): Promise<void> {
  await tx.insert(writeoffApprovals).values(row);
}

export async function findWriteoffById(id: string, tenantId: string): Promise<WriteoffRow | null> {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(writeoffApprovals)
    .where(and(eq(writeoffApprovals.id, id), eq(writeoffApprovals.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findApprovedWriteoff(tenantId: string, assetId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(writeoffApprovals).where(and(
    eq(writeoffApprovals.tenantId, tenantId),
    eq(writeoffApprovals.assetId, assetId),
    eq(writeoffApprovals.status, "approved"),
  )).limit(1));
  return rows[0] ?? null;
}

// P0-1 + P0-2: tenant-scoped, and only flips a still-pending request to approved
// (the SoD check on requestedBy vs approvedBy is enforced in commands.ts).
export async function approveWriteoff(tx: Writer, id: string, tenantId: string, approvedBy: string): Promise<void> {
  await tx.update(writeoffApprovals).set({
    status: "approved", approvedBy, approvedAt: new Date(),
  }).where(and(
    eq(writeoffApprovals.id, id),
    eq(writeoffApprovals.tenantId, tenantId),
    eq(writeoffApprovals.status, "pending"),
  ));
}
