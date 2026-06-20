import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeAuditParas, type AuditParaInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAuditPara(tx: Writer, row: AuditParaInsert): Promise<void> {
  await tx.insert(financeAuditParas).values(row);
}
