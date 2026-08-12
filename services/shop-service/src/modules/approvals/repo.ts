import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { scrutinyRecords, type ScrutinyRecordRow, type ScrutinyRecordInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<ScrutinyRecordRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(scrutinyRecords)
      .where(and(eq(scrutinyRecords.id, id), eq(scrutinyRecords.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByApplication(applicationId: string, tenantId: string): Promise<ScrutinyRecordRow[]> {
  return scopedRead((tx) =>
    tx.select().from(scrutinyRecords)
      .where(and(
        eq(scrutinyRecords.tenantId, tenantId),
        eq(scrutinyRecords.applicationId, applicationId),
      ))
      .orderBy(desc(scrutinyRecords.createdAt)),
  );
}

export async function insertScrutiny(tx: ScopedTx, row: ScrutinyRecordInsert): Promise<void> {
  await tx.insert(scrutinyRecords).values(row);
}

export async function completeScrutiny(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  findings: Record<string, unknown>,
  deficiencyDetails: string | null,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(scrutinyRecords)
    .set({
      status,
      findings,
      deficiencyDetails,
      completedAt: new Date(),
      updatedBy,
      updatedAt: new Date(),
    })
    .where(and(eq(scrutinyRecords.id, id), eq(scrutinyRecords.tenantId, tenantId)))
    .returning({ id: scrutinyRecords.id });
  return result.length > 0;
}
