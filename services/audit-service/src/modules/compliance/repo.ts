import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditPendingRegister, type PendingRegisterRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPendingRegister(tx: Writer, row: typeof auditPendingRegister.$inferInsert): Promise<void> {
  await tx.insert(auditPendingRegister).values(row);
}

export async function listPendingRegister(tenantId: string, status = "pending"): Promise<PendingRegisterRow[]> {
  return db.select().from(auditPendingRegister).where(
    and(eq(auditPendingRegister.tenantId, tenantId), eq(auditPendingRegister.status, status)),
  );
}
