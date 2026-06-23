import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsServiceBookEntries } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select">;

export async function listServiceBookEntries(tenantId: string, employeeId: string) {
  return db.select().from(hrmsServiceBookEntries).where(and(
    eq(hrmsServiceBookEntries.employeeId, employeeId),
    eq(hrmsServiceBookEntries.tenantId, tenantId),
  )).orderBy(asc(hrmsServiceBookEntries.effectiveDate));
}

export async function insertServiceBookEntry(tx: Writer, row: typeof hrmsServiceBookEntries.$inferInsert): Promise<void> {
  await tx.insert(hrmsServiceBookEntries).values(row);
}
