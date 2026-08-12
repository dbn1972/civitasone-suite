import { eq, and, sql } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { advScrutinyRecords, type AdvScrutinyRow, type AdvScrutinyInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AdvScrutinyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advScrutinyRecords)
      .where(and(eq(advScrutinyRecords.id, id), eq(advScrutinyRecords.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByApplication(applicationId: string, tenantId: string): Promise<AdvScrutinyRow[]> {
  return scopedRead((tx) =>
    tx.select().from(advScrutinyRecords)
      .where(and(eq(advScrutinyRecords.applicationId, applicationId), eq(advScrutinyRecords.tenantId, tenantId))),
  );
}

export async function insertScrutiny(tx: ScopedTx, row: AdvScrutinyInsert): Promise<void> {
  await tx.insert(advScrutinyRecords).values(row);
}

export async function completeScrutiny(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  findings: Record<string, unknown>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(advScrutinyRecords)
    .set({
      status: "completed",
      findings,
      completedAt: new Date(),
      updatedBy,
      updatedAt: new Date(),
      version: sql`${advScrutinyRecords.version} + 1`,
    })
    .where(and(eq(advScrutinyRecords.id, id), eq(advScrutinyRecords.tenantId, tenantId)))
    .returning({ id: advScrutinyRecords.id });
  return result.length > 0;
}
