import { db } from "../../shared/db.js";
import { legalSettlements, legalLokAdalat } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertSettlement(tx: Writer, row: typeof legalSettlements.$inferInsert): Promise<void> {
  await tx.insert(legalSettlements).values(row);
}

export async function insertLokAdalat(tx: Writer, row: typeof legalLokAdalat.$inferInsert): Promise<void> {
  await tx.insert(legalLokAdalat).values(row);
}
