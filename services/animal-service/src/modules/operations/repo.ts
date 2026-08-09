import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { animalOperations, type OperationRow, type OperationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<OperationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(animalOperations)
      .where(and(eq(animalOperations.id, id), eq(animalOperations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByComplaint(
  complaintId: string,
  tenantId: string,
): Promise<OperationRow[]> {
  return scopedRead((tx) =>
    tx.select().from(animalOperations)
      .where(and(eq(animalOperations.complaintId, complaintId), eq(animalOperations.tenantId, tenantId)))
      .orderBy(desc(animalOperations.performedAt)),
  );
}

export async function insertOperation(tx: ScopedTx, row: OperationInsert): Promise<void> {
  await tx.insert(animalOperations).values(row);
}
