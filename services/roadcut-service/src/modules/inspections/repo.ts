import { eq, and, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { roadcutInspections, type InspectionRow, type InspectionInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<InspectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(roadcutInspections)
      .where(and(eq(roadcutInspections.id, id), eq(roadcutInspections.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByPermit(permitId: string, tenantId: string): Promise<InspectionRow[]> {
  return scopedRead((tx) =>
    tx.select().from(roadcutInspections)
      .where(and(
        eq(roadcutInspections.tenantId, tenantId),
        eq(roadcutInspections.permitId, permitId),
      ))
      .orderBy(desc(roadcutInspections.createdAt)),
  );
}

export async function insertInspection(tx: ScopedTx, row: InspectionInsert): Promise<void> {
  await tx.insert(roadcutInspections).values(row);
}

export async function completeInspection(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  findings: Record<string, unknown>,
  photos: Array<{ fileId: string; caption?: string }> | null,
  restorationQuality: string | null,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(roadcutInspections)
    .set({
      status,
      findings,
      photos,
      restorationQuality,
      inspectedAt: new Date(),
      updatedBy,
      updatedAt: new Date(),
    })
    .where(and(eq(roadcutInspections.id, id), eq(roadcutInspections.tenantId, tenantId)))
    .returning({ id: roadcutInspections.id });
  return result.length > 0;
}
