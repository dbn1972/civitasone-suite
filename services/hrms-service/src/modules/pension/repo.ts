import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsPensionRecords } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select">;

export async function insertPensionRecord(
  tx: Writer,
  row: typeof hrmsPensionRecords.$inferInsert,
): Promise<void> {
  await tx.insert(hrmsPensionRecords).values(row);
}

export async function listByEmployee(tenantId: string, employeeId: string) {
  return scopedRead((tx) => tx
    .select()
    .from(hrmsPensionRecords)
    .where(and(eq(hrmsPensionRecords.tenantId, tenantId), eq(hrmsPensionRecords.employeeId, employeeId)))
    .orderBy(desc(hrmsPensionRecords.createdAt)));
}
