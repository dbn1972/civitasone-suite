import { eq, and, lte, gte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { contractContracts, contractAmendments, type ContractRow, type ContractInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findContractById(id: string): Promise<ContractRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(contractContracts).where(eq(contractContracts.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function listContractsByTenant(tenantId: string, limit: number): Promise<ContractRow[]> {
  return scopedRead((tx) => tx.select().from(contractContracts)
    .where(eq(contractContracts.tenantId, tenantId))
    .orderBy(sql`${contractContracts.createdAt} desc`)
    .limit(limit));
}

/** Read model: active contracts in force. */
export async function listActiveByTenant(tenantId: string, limit: number): Promise<ContractRow[]> {
  return scopedRead((tx) => tx.select().from(contractContracts)
    .where(and(eq(contractContracts.tenantId, tenantId), eq(contractContracts.status, "active")))
    .orderBy(sql`${contractContracts.expiry} asc`)
    .limit(limit));
}

/** Read model: active contracts expiring on or before `before` (YYYY-MM-DD). */
export async function listExpiringByTenant(tenantId: string, before: string, limit: number): Promise<ContractRow[]> {
  return scopedRead((tx) => tx.select().from(contractContracts)
    .where(and(
      eq(contractContracts.tenantId, tenantId),
      eq(contractContracts.status, "active"),
      lte(contractContracts.expiry, before),
      gte(contractContracts.expiry, sql`current_date`),
    ))
    .orderBy(sql`${contractContracts.expiry} asc`)
    .limit(limit));
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

export async function listAmendments(contractId: string, tenantId: string, limit = 100): Promise<Array<typeof contractAmendments.$inferSelect>> {
  return scopedRead((tx) => tx.select().from(contractAmendments)
    .where(and(eq(contractAmendments.contractId, contractId), eq(contractAmendments.tenantId, tenantId)))
    .orderBy(sql`${contractAmendments.amendmentNo} asc`)
    .limit(limit));
}

export async function countAmendments(tx: Writer, contractId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(contractAmendments).where(eq(contractAmendments.contractId, contractId)).limit(500);
  return rows.length;
}
