import { db } from "../../shared/db.js";
import { auditExports, type ExportInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertExport(tx: Writer, row: ExportInsert): Promise<void> {
  await tx.insert(auditExports).values(row);
}
