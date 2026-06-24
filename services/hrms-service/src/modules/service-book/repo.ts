import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsServiceBookEntries, type ServiceBookRow } from "./schema.js";

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

export async function getEntry(tenantId: string, entryId: string): Promise<ServiceBookRow | undefined> {
  const rows = await db.select().from(hrmsServiceBookEntries).where(and(
    eq(hrmsServiceBookEntries.id, entryId),
    eq(hrmsServiceBookEntries.tenantId, tenantId),
  )).limit(1);
  return rows[0];
}

/**
 * Attest an entry: competent-authority sign-off. Guarded so it only flips an
 * un-attested entry — re-attesting returns null. Once attested the entry is
 * immutable (enforced at the route layer for edits).
 */
export async function attestEntry(
  tenantId: string, entryId: string, attestedBy: string, remarks: string | null,
): Promise<ServiceBookRow | null> {
  const rows = await db.update(hrmsServiceBookEntries)
    .set({ attested: true, attestedBy, attestedAt: new Date(), attestRemarks: remarks })
    .where(and(
      eq(hrmsServiceBookEntries.id, entryId),
      eq(hrmsServiceBookEntries.tenantId, tenantId),
      eq(hrmsServiceBookEntries.attested, false),
    ))
    .returning();
  return rows[0] ?? null;
}

export async function updateEntryDescription(
  tenantId: string, entryId: string, description: string, documentRef: string | null,
): Promise<void> {
  await db.update(hrmsServiceBookEntries)
    .set({ description, documentRef })
    .where(and(
      eq(hrmsServiceBookEntries.id, entryId),
      eq(hrmsServiceBookEntries.tenantId, tenantId),
    ));
}
