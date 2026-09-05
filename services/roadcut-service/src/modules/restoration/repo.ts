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

/**
 * Same lookup as `findById`, but reads through an ALREADY-OPEN transaction
 * instead of opening a second one via `scopedRead` — see applications/repo.ts's
 * findByIdInTx for the full nested-transaction deadlock rationale this
 * avoids. Used by this module's own decideDepositRefund consumer, which
 * needs this restoration row's permitId to resolve the citizen recipient
 * (restoration -> permit -> application) inside its own write transaction.
 */
export async function findByIdInTx(tx: ScopedTx, id: string, tenantId: string): Promise<RestorationRow | null> {
  const rows = await tx.select().from(roadcutRestorations)
    .where(and(eq(roadcutRestorations.id, id), eq(roadcutRestorations.tenantId, tenantId)))
    .limit(1);
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
  // The route pre-checks `existing.quality !== "pending"` before publishing,
  // but that check and this write happen in two separate steps (route ->
  // queue -> consumer) with no lock held in between — two concurrent
  // /complete calls can both pass the route's check before either command is
  // applied. Re-asserting `quality = 'pending'` here (not just id+tenantId)
  // makes the second of two racing commands a genuine no-op instead of
  // silently overwriting the first assessment.
  const result = await tx.update(roadcutRestorations)
    .set({
      quality,
      restorationEndDate: endDate,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutRestorations.version} + 1`,
    })
    .where(and(
      eq(roadcutRestorations.id, id),
      eq(roadcutRestorations.tenantId, tenantId),
      eq(roadcutRestorations.quality, "pending"),
    ))
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
  // Same race as completeRestoration above, for the refund decision: the
  // route's `existing.depositRefundStatus !== "held"` pre-check can't see a
  // concurrent decision that's still in flight through the queue. Re-asserting
  // `deposit_refund_status = 'held'` in the WHERE clause means only the FIRST
  // of two racing decisions actually applies — the second becomes a no-op
  // (caller sees 202 either way, since this is async, but the DB never ends
  // up reflecting whichever decision merely arrived last).
  const result = await tx.update(roadcutRestorations)
    .set({
      depositRefundStatus,
      refundMinor,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${roadcutRestorations.version} + 1`,
    })
    .where(and(
      eq(roadcutRestorations.id, id),
      eq(roadcutRestorations.tenantId, tenantId),
      eq(roadcutRestorations.depositRefundStatus, "held"),
    ))
    .returning({ id: roadcutRestorations.id });
  return result.length > 0;
}
