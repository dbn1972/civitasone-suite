import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsTransfers, hrmsPromotions, hrmsSeparations, type TransferRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTransfer(tx: Writer, row: typeof hrmsTransfers.$inferInsert): Promise<void> {
  await tx.insert(hrmsTransfers).values(row);
}

type TransferSet = Partial<Pick<
  typeof hrmsTransfers.$inferInsert,
  "orderNo" | "orderDate" | "orderRef" | "relievedDate" | "joinedDate"
>>;

/**
 * Guarded state transition for a transfer order. Only flips status when the
 * current status is in `from`; bumps version + updatedAt. Returns the updated
 * row, or null when the guard rejected (wrong state / not found).
 */
export async function transitionTransfer(
  tenantId: string,
  id: string,
  actorId: string,
  opts: { from: string[]; to: string; set?: TransferSet },
  tx: Writer = db,
): Promise<TransferRow | null> {
  const rows = await tx.update(hrmsTransfers)
    .set({
      ...opts.set,
      status: opts.to,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsTransfers.version} + 1`,
    })
    .where(and(
      eq(hrmsTransfers.id, id),
      eq(hrmsTransfers.tenantId, tenantId),
      inArray(hrmsTransfers.status, opts.from),
    ))
    .returning();
  return rows[0] ?? null;
}

export async function insertPromotion(tx: Writer, row: typeof hrmsPromotions.$inferInsert): Promise<void> {
  await tx.insert(hrmsPromotions).values(row);
}

export async function insertSeparation(tx: Writer, row: typeof hrmsSeparations.$inferInsert): Promise<void> {
  await tx.insert(hrmsSeparations).values(row);
}
