import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsTransfers, hrmsPromotions, hrmsSeparations } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTransfer(tx: Writer, row: typeof hrmsTransfers.$inferInsert): Promise<void> {
  await tx.insert(hrmsTransfers).values(row);
}

export async function insertPromotion(tx: Writer, row: typeof hrmsPromotions.$inferInsert): Promise<void> {
  await tx.insert(hrmsPromotions).values(row);
}

export async function insertSeparation(tx: Writer, row: typeof hrmsSeparations.$inferInsert): Promise<void> {
  await tx.insert(hrmsSeparations).values(row);
}
