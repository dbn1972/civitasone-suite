import { eq, asc, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { transitionHistory, type TransitionInsert, type TransitionRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select">;

/** Append a transition record. Insert-only; the table trigger blocks updates/deletes. */
export async function record(tx: Writer, row: Omit<TransitionInsert, "id" | "createdAt">): Promise<void> {
  await tx.insert(transitionHistory).values(row);
}

export async function listForInstance(instanceId: string, tenantId: string): Promise<TransitionRow[]> {
  return db.select().from(transitionHistory)
    .where(and(eq(transitionHistory.instanceId, instanceId), eq(transitionHistory.tenantId, tenantId)))
    .orderBy(asc(transitionHistory.createdAt));
}
