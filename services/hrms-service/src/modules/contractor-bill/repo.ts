import { eq, and, desc, ne, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsContractors, hrmsContractorBills,
  type ContractorRow, type ContractorInsert,
  type ContractorBillRow, type ContractorBillInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type Reader = Pick<typeof db, "select">;
type TxExec = { execute: (q: SQL) => Promise<unknown> };

// ---------------- contractors ----------------
export async function insertContractor(tx: Writer, row: ContractorInsert): Promise<void> {
  await tx.insert(hrmsContractors).values(row);
}

export async function findContractor(tenantId: string, id: string): Promise<ContractorRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsContractors)
    .where(and(eq(hrmsContractors.tenantId, tenantId), eq(hrmsContractors.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listContractors(tenantId: string, limit = 200): Promise<ContractorRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsContractors)
    .where(eq(hrmsContractors.tenantId, tenantId))
    .orderBy(desc(hrmsContractors.createdAt)).limit(limit));
}

export async function updateContractor(
  tx: Writer, tenantId: string, id: string, patch: Partial<ContractorInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsContractors)
    .set({ ...patch, version: sql`${hrmsContractors.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsContractors.tenantId, tenantId), eq(hrmsContractors.id, id), eq(hrmsContractors.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "contractor was modified by another request; reload and retry");
  }
}

// ---------------- bills ----------------
export async function insertBill(tx: Writer, row: ContractorBillInsert): Promise<void> {
  await tx.insert(hrmsContractorBills).values(row);
}

export async function findBill(tenantId: string, id: string): Promise<ContractorBillRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsContractorBills)
    .where(and(eq(hrmsContractorBills.tenantId, tenantId), eq(hrmsContractorBills.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listBillsByContractor(tenantId: string, contractorId: string, limit = 200): Promise<ContractorBillRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsContractorBills)
    .where(and(eq(hrmsContractorBills.tenantId, tenantId), eq(hrmsContractorBills.contractorId, contractorId)))
    .orderBy(desc(hrmsContractorBills.submittedAt)).limit(limit));
}

export async function listBillsByStatus(tenantId: string, status: string, limit = 200): Promise<ContractorBillRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsContractorBills)
    .where(and(eq(hrmsContractorBills.tenantId, tenantId), eq(hrmsContractorBills.status, status)))
    .orderBy(desc(hrmsContractorBills.submittedAt)).limit(limit));
}

function ytdConds(tenantId: string, contractorId: string, fyFrom: string, fyTo: string, excludeId?: string) {
  const conds = [
    eq(hrmsContractorBills.tenantId, tenantId),
    eq(hrmsContractorBills.contractorId, contractorId),
    sql`${hrmsContractorBills.status} IN ('approved','paid')`,
    gte(hrmsContractorBills.billDate, fyFrom),
    lte(hrmsContractorBills.billDate, fyTo),
  ];
  if (excludeId) conds.push(ne(hrmsContractorBills.id, excludeId));
  return conds;
}

async function ytdOn(reader: Reader, tenantId: string, contractorId: string, fyFrom: string, fyTo: string, excludeId?: string): Promise<bigint> {
  const rows = await reader
    .select({ total: sql<string>`COALESCE(SUM(${hrmsContractorBills.grossMinor}), 0)` })
    .from(hrmsContractorBills)
    .where(and(...ytdConds(tenantId, contractorId, fyFrom, fyTo, excludeId)));
  return BigInt(rows[0]?.total ?? "0");
}

/** YTD approved+paid gross for a contractor within the FY, through an open txn. */
export async function ytdApprovedGrossTx(
  tx: Reader, tenantId: string, contractorId: string, fyFrom: string, fyTo: string, excludeId?: string,
): Promise<bigint> {
  return ytdOn(tx, tenantId, contractorId, fyFrom, fyTo, excludeId);
}

/** Serialize bill approvals per contractor (advisory xact lock) so concurrent
 *  approvals can't both read a pre-threshold YTD total and under-deduct 194C. */
export async function lockContractorForBilling(tx: TxExec, tenantId: string, contractorId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${contractorId}`}, 0))`);
}

export async function updateBill(
  tx: Writer, tenantId: string, id: string, patch: Partial<ContractorBillInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsContractorBills)
    .set({ ...patch, version: sql`${hrmsContractorBills.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsContractorBills.tenantId, tenantId),
      eq(hrmsContractorBills.id, id),
      eq(hrmsContractorBills.version, expectedVersion),
    ));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "bill was modified by another request; reload and retry");
  }
}
