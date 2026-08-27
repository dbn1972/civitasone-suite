import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { fireInspectionsTable } from "./schema.js";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import type { FireInspectionInsert } from "./schema.js";

export async function findById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireInspectionsTable)
      .where(and(eq(fireInspectionsTable.tenantId, tenantId), eq(fireInspectionsTable.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function findByApplicationId(tenantId: string, applicationId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(fireInspectionsTable)
      .where(
        and(
          eq(fireInspectionsTable.tenantId, tenantId),
          eq(fireInspectionsTable.applicationId, applicationId),
        ),
      )
      .orderBy(desc(fireInspectionsTable.createdAt));
    return rows;
  });
}

export async function insert(tx: ScopedTx, data: FireInspectionInsert) {
  const rows = await tx.insert(fireInspectionsTable).values(data).returning();
  return rows[0]!;
}

export async function updateStatus(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  status: string,
  updates: Record<string, unknown>,
  fromStatuses: readonly string[],
  actorId: string,
) {
  const rows = await tx
    .update(fireInspectionsTable)
    .set({
      status,
      version: sql`${fireInspectionsTable.version} + 1`,
      updatedAt: new Date(),
      updatedBy: actorId,
      ...updates,
    })
    .where(and(
      eq(fireInspectionsTable.tenantId, tenantId),
      eq(fireInspectionsTable.id, id),
      inArray(fireInspectionsTable.status, fromStatuses as string[]),
    ))
    .returning();
  return rows[0] ?? null;
}
