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
  // BUG FIX (race): the route's canComplete() pre-check ("status must be
  // 'scheduled'") and this write happen in two separate steps (route ->
  // queue -> consumer) with no lock held in between — two concurrent
  // /complete calls for the same inspection can both pass the route's check
  // before either command is applied, and without a status re-check here the
  // second racer would silently overwrite the first assessment's findings.
  // Re-asserting `status = 'scheduled'` in the WHERE clause (not just
  // id+tenantId) makes the second of two racing commands a genuine no-op,
  // the same pattern already used in this service for permits/restoration
  // (restoration/repo.ts's completeRestoration and updateDepositRefund).
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
    .where(and(
      eq(roadcutInspections.id, id),
      eq(roadcutInspections.tenantId, tenantId),
      eq(roadcutInspections.status, "scheduled"),
    ))
    .returning({ id: roadcutInspections.id });
  return result.length > 0;
}
