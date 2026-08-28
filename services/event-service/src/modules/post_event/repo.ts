import { eq, and, sql, isNull } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventPostInspections, type PostInspectionRow, type PostInspectionInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<PostInspectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventPostInspections)
      .where(and(eq(eventPostInspections.id, id), eq(eventPostInspections.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByPermit(permitId: string, tenantId: string): Promise<PostInspectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventPostInspections)
      .where(and(eq(eventPostInspections.permitId, permitId), eq(eventPostInspections.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insertInspection(tx: ScopedTx, row: PostInspectionInsert): Promise<void> {
  await tx.insert(eventPostInspections).values(row);
}

export async function updateDepositDecision(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  depositDecision: string,
  refundMinor: bigint,
  updatedBy: string,
): Promise<PostInspectionRow | null> {
  const result = await tx.update(eventPostInspections)
    .set({
      depositDecision,
      refundMinor,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${eventPostInspections.version} + 1`,
    })
    .where(and(
      eq(eventPostInspections.id, id),
      eq(eventPostInspections.tenantId, tenantId),
      // Atomic equivalent of canDecideDeposit's `depositDecision === null` — a
      // duplicate/racing deposit-decide command can no longer silently
      // overwrite an already-decided deposit.
      isNull(eventPostInspections.depositDecision),
    ))
    .returning();
  return result[0] ?? null;
}
