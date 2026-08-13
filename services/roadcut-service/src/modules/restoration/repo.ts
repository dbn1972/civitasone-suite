import { eq, and, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { roadcutRestorations, type RestorationRow, type RestorationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<RestorationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutRestorations)
      .where(and(eq(roadcutRestorations.id, id), eq(roadcutRestorations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByPermit(permitId: string, tenantId: string): Promise<RestorationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutRestorations)
      .where(and(eq(roadcutRestorations.permitId, permitId), eq(roadcutRestorations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertRestoration(tx: ScopedTx, row: RestorationInsert): Promise<void> {
  await tx.insert(roadcutRestorations).values(row);
}

export async function completeRestoration(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  quality: string,
  endDate: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutRestorations)
    .set({
      quality,
      restorationEndDate: endDate,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutRestorations.version} + 1`,
    })
    .where(and(eq(roadcutRestorations.id, id), eq(roadcutRestorations.tenantId, tenantId)))
    .returning({ id: roadcutRestorations.id });
  return result.length > 0;
}

export async function updateDepositRefund(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  depositRefundStatus: string,
  refundMinor: bigint,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutRestorations)
    .set({
      depositRefundStatus,
      refundMinor,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutRestorations.version} + 1`,
    })
    .where(and(eq(roadcutRestorations.id, id), eq(roadcutRestorations.tenantId, tenantId)))
    .returning({ id: roadcutRestorations.id });
  return result.length > 0;
}
