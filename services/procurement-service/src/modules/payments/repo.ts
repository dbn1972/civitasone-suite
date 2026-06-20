import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementAdvances, type AdvanceInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAdvance(tx: Writer, row: AdvanceInsert): Promise<void> {
  await tx.insert(procurementAdvances).values(row);
}
