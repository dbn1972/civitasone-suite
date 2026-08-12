import { eq, and, desc } from "drizzle-orm";
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
  officerId: string,
): Promise<boolean> {
  const result = await tx.update(eventNocRequests)
    .set({
      status,
      conditions,
      officerId,
      respondedAt: new Date(),
      updatedBy: officerId,
      updatedAt: new Date(),
    })
    .where(and(eq(eventNocRequests.id, id), eq(eventNocRequests.tenantId, tenantId)))
    .returning({ id: eventNocRequests.id });
  return result.length > 0;
}
