import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventNocRequests, type NocRequestRow, type NocRequestInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<NocRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventNocRequests)
      .where(and(eq(eventNocRequests.id, id), eq(eventNocRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByApplication(applicationId: string, tenantId: string): Promise<NocRequestRow[]> {
  return scopedRead((tx) =>
    tx.select().from(eventNocRequests)
      .where(and(
        eq(eventNocRequests.tenantId, tenantId),
        eq(eventNocRequests.applicationId, applicationId),
      ))
      .orderBy(desc(eventNocRequests.createdAt)),
  );
}

export async function insertNocRequest(tx: ScopedTx, row: NocRequestInsert): Promise<void> {
  await tx.insert(eventNocRequests).values(row);
}

export async function respondNoc(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  conditions: Record<string, unknown> | null,
  fromStatuses: readonly string[],
  officerId: string,
): Promise<NocRequestRow | null> {
  const result = await tx.update(eventNocRequests)
    .set({
      status,
      conditions,
      officerId,
      respondedAt: new Date(),
      updatedBy: officerId,
      updatedAt: new Date(),
      // A double-submit or two officers racing to respond both used to pass the
      // route-level pre-check (both read status="requested" before either write
      // landed) and both would then succeed here, the second silently
      // overwriting the first's decision (approved -> rejected with neither
      // caller told). version wasn't read/incremented anywhere either, so there
      // was no optimistic-concurrency backstop.
      version: sql`${eventNocRequests.version} + 1`,
    })
    .where(and(
      eq(eventNocRequests.id, id),
      eq(eventNocRequests.tenantId, tenantId),
      inArray(eventNocRequests.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
