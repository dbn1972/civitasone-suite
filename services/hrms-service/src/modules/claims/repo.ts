import { eq, and, asc, ne, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsLtcClaims, hrmsCeaClaims,
  type LtcClaimRow, type LtcClaimInsert, type CeaClaimRow, type CeaClaimInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ---------------- LTC ----------------
export async function insertLtc(tx: Writer, row: LtcClaimInsert): Promise<void> {
  await tx.insert(hrmsLtcClaims).values(row);
}

export async function findLtc(tenantId: string, id: string): Promise<LtcClaimRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsLtcClaims)
    .where(and(eq(hrmsLtcClaims.tenantId, tenantId), eq(hrmsLtcClaims.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listLtcByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<LtcClaimRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsLtcClaims)
    .where(and(eq(hrmsLtcClaims.tenantId, tenantId), eq(hrmsLtcClaims.employeeId, employeeId)))
    .orderBy(asc(hrmsLtcClaims.submittedAt))
    .limit(limit));
}

export async function updateLtc(
  tx: Writer, tenantId: string, id: string, patch: Partial<LtcClaimInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsLtcClaims)
    .set({ ...patch, version: sql`${hrmsLtcClaims.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsLtcClaims.tenantId, tenantId), eq(hrmsLtcClaims.id, id), eq(hrmsLtcClaims.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "LTC claim was modified by another request; reload and retry");
  }
}

// ---------------- CEA ----------------
export async function insertCea(tx: Writer, row: CeaClaimInsert): Promise<void> {
  await tx.insert(hrmsCeaClaims).values(row);
}

export async function findCea(tenantId: string, id: string): Promise<CeaClaimRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCeaClaims)
    .where(and(eq(hrmsCeaClaims.tenantId, tenantId), eq(hrmsCeaClaims.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listCeaByEmployee(tenantId: string, employeeId: string, limit = 200): Promise<CeaClaimRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCeaClaims)
    .where(and(eq(hrmsCeaClaims.tenantId, tenantId), eq(hrmsCeaClaims.employeeId, employeeId)))
    .orderBy(asc(hrmsCeaClaims.submittedAt))
    .limit(limit));
}

/**
 * Sum of CLAIMED amounts already committed (submitted or approved, not the row
 * being checked) for the same child + kind + academic year. Used to enforce the
 * per-child annual cap across multiple claims. Excludes rejected/cancelled and
 * the optional `excludeId`.
 */
export async function ceaCommittedForChild(
  tenantId: string, employeeId: string, academicYear: string,
  childRef: string, claimKind: string, excludeId?: string,
): Promise<bigint> {
  const conds = [
    eq(hrmsCeaClaims.tenantId, tenantId),
    eq(hrmsCeaClaims.employeeId, employeeId),
    eq(hrmsCeaClaims.academicYear, academicYear),
    eq(hrmsCeaClaims.childRef, childRef),
    eq(hrmsCeaClaims.claimKind, claimKind),
    sql`${hrmsCeaClaims.status} IN ('submitted','approved')`,
  ];
  if (excludeId) conds.push(ne(hrmsCeaClaims.id, excludeId));
  const rows = await scopedRead((tx) => tx
    .select({ total: sql<string>`COALESCE(SUM(${hrmsCeaClaims.claimedAmountMinor}), 0)` })
    .from(hrmsCeaClaims)
    .where(and(...conds)));
  return BigInt(rows[0]?.total ?? "0");
}

export async function updateCea(
  tx: Writer, tenantId: string, id: string, patch: Partial<CeaClaimInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsCeaClaims)
    .set({ ...patch, version: sql`${hrmsCeaClaims.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsCeaClaims.tenantId, tenantId), eq(hrmsCeaClaims.id, id), eq(hrmsCeaClaims.version, expectedVersion)));
  if ((res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "CEA claim was modified by another request; reload and retry");
  }
}
