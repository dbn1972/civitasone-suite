import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { orders } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type OrderRow    = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;

export async function insertOrder(tx: Writer, row: OrderInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(orders).values(row).onConflictDoNothing({ target: orders.id });
}

export async function listOrdersByCase(tenantId: string, caseId: string): Promise<OrderRow[]> {
  return scopedRead((tx) => tx.select().from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.caseId, caseId)))
    .orderBy(desc(orders.orderDate)));
}

export async function getOrderById(tenantId: string, id: string): Promise<OrderRow | undefined> {
  const rows = await scopedRead<OrderRow[]>((tx) => tx.select().from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
    .limit(1));
  return rows[0];
}
