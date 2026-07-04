import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementAdvances, procurementDebitNotes, type AdvanceInsert, type DebitNoteInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAdvance(tx: Writer, row: AdvanceInsert): Promise<void> {
  await tx.insert(procurementAdvances).values(row);
}

export async function insertDebitNote(tx: Writer, row: DebitNoteInsert): Promise<void> {
  await tx.insert(procurementDebitNotes).values(row);
}
