import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contractContracts, contractAmendments, type ContractRow, type ContractInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findContractById(id: string): Promise<ContractRow | null> {
  const rows = await db.select().from(contractContracts).where(eq(contractContracts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listContractsByTenant(tenantId: string, limit: number): Promise<ContractRow[]> {
  return db.select().from(contractContracts).where(eq(contractContracts.tenantId, tenantId)).limit(limit);
}

export async function findContractByIdTx(tx: Writer, id: string): Promise<ContractRow | null> {
  const rows = await (tx as typeof db).select().from(contractContracts).where(eq(contractContracts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertContract(tx: Writer, row: ContractInsert): Promise<void> {
  await tx.insert(contractContracts).values(row);
}

export async function updateContract(tx: Writer, id: string, patch: Partial<ContractInsert>): Promise<void> {
  await tx.update(contractContracts).set({ ...patch, updatedAt: new Date() }).where(eq(contractContracts.id, id));
}

export async function insertAmendment(tx: Writer, row: typeof contractAmendments.$inferInsert): Promise<void> {
  await tx.insert(contractAmendments).values(row);
}

export async function countAmendments(tx: Writer, contractId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(contractAmendments).where(eq(contractAmendments.contractId, contractId));
  return rows.length;
}
