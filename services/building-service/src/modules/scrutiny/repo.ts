import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { buildingScrutiny, type BuildingScrutinyRow, type BuildingScrutinyInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BuildingScrutinyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingScrutiny)
      .where(and(eq(buildingScrutiny.id, id), eq(buildingScrutiny.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByApplication(applicationId: string, tenantId: string): Promise<BuildingScrutinyRow[]> {
  return scopedRead((tx) =>
    tx.select().from(buildingScrutiny)
      .where(and(eq(buildingScrutiny.tenantId, tenantId), eq(buildingScrutiny.applicationId, applicationId)))
      .orderBy(desc(buildingScrutiny.createdAt)),
  );
}

export async function insertScrutiny(tx: ScopedTx, row: BuildingScrutinyInsert): Promise<void> {
  await tx.insert(buildingScrutiny).values(row);
}

export async function completeScrutiny(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  findings: Record<string, unknown>, dcrResults: Record<string, unknown> | null,
  deficiencyDetails: string | null, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingScrutiny)
    .set({ status, findings, dcrResults, deficiencyDetails, completedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(buildingScrutiny.id, id), eq(buildingScrutiny.tenantId, tenantId)))
    .returning({ id: buildingScrutiny.id });
  return result.length > 0;
}
