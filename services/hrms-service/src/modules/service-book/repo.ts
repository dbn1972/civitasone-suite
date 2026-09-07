import { eq, and, asc } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsServiceBookEntries, type ServiceBookRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "select" | "update">;

export async function listServiceBookEntries(tenantId: string, employeeId: string, limit = 500) {
  return scopedRead((tx) => tx.select().from(hrmsServiceBookEntries).where(and(
    eq(hrmsServiceBookEntries.employeeId, employeeId),
    eq(hrmsServiceBookEntries.tenantId, tenantId),
  )).orderBy(asc(hrmsServiceBookEntries.effectiveDate)).limit(limit));
}

/**
 * Tx-scoped variant of listServiceBookEntries -- see
 * .claude/skills/16-production-readiness-audit.md section 1. Cross-module
 * caller: pension/f3-consumer.ts reads the employee's service book from
 * INSIDE its own already-open db.transaction() to compute pension eligibility;
 * the scopedRead-based listServiceBookEntries opened a SECOND transaction
 * there, deadlocking the pool under concurrent load.
 */
export async function listServiceBookEntriesTx(tx: Writer, tenantId: string, employeeId: string, limit = 500) {
  return (tx as typeof db).select().from(hrmsServiceBookEntries).where(and(
    eq(hrmsServiceBookEntries.employeeId, employeeId),
    eq(hrmsServiceBookEntries.tenantId, tenantId),
  )).orderBy(asc(hrmsServiceBookEntries.effectiveDate)).limit(limit);
}

export async function insertServiceBookEntry(tx: Writer, row: typeof hrmsServiceBookEntries.$inferInsert): Promise<void> {
  await tx.insert(hrmsServiceBookEntries).values(row);
}

export async function getEntry(tenantId: string, entryId: string): Promise<ServiceBookRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsServiceBookEntries).where(and(
    eq(hrmsServiceBookEntries.id, entryId),
    eq(hrmsServiceBookEntries.tenantId, tenantId),
  )).limit(1));
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
  return db.transaction((tx) => attestEntryTx(tx, tenantId, entryId, attestedBy, remarks));
}

/**
 * Tx-scoped variant of attestEntry -- see .claude/skills/16-production-readiness-audit.md
 * section 1. attestEntry opened its own RAW db.transaction() (not scopedRead,
 * but the identical bug shape) when called from inside service-book/consumer.ts's
 * already-open outer db.transaction(), deadlocking the pool under concurrent load.
 */
export async function attestEntryTx(
  tx: Writer, tenantId: string, entryId: string, attestedBy: string, remarks: string | null,
): Promise<ServiceBookRow | null> {
  const rows = await (tx as typeof db).update(hrmsServiceBookEntries)
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
  await db.transaction((tx) => tx.update(hrmsServiceBookEntries)
    .set({ description, documentRef })
    .where(and(
      eq(hrmsServiceBookEntries.id, entryId),
      eq(hrmsServiceBookEntries.tenantId, tenantId),
    )));
}
