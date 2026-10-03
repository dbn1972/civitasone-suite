import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { scopedRead, type Db } from "../../shared/db.js";
import { financeSanctions } from "../budget/schema.js";
import { financeUC, type UCRow } from "./schema.js";
import { UC_CLAIMING_STATUSES } from "./uc-domain.js";

type Q = Pick<Db, "select">;

/** An approved sanction whose number equals the UC's grant reference, or null (free-text reference). */
export async function findApprovedSanctionByNo(tx: Q, tenantId: string, sanctionNo: string, lock = false): Promise<{ id: string; amountMinor: bigint } | null> {
  const q = tx.select({ id: financeSanctions.id, amountMinor: financeSanctions.amountMinor }).from(financeSanctions)
    .where(and(eq(financeSanctions.tenantId, tenantId), eq(financeSanctions.sanctionNo, sanctionNo), eq(financeSanctions.status, "approved")));
  const rows = await (lock ? q.for("update").limit(1) : q.limit(1));
  return rows[0] ?? null;
}

/** Sum of claiming UCs recorded against a grant reference (optionally excluding one UC). */
export async function sumClaimedForGrantRef(tx: Q, tenantId: string, grantRef: string, excludeId?: string): Promise<bigint> {
  const rows = await tx.select({ total: sql<string>`coalesce(sum(${financeUC.amountMinor}), 0)::text` }).from(financeUC)
    .where(and(
      eq(financeUC.tenantId, tenantId), eq(financeUC.grantRef, grantRef),
      inArray(financeUC.status, [...UC_CLAIMING_STATUSES]),
      excludeId ? ne(financeUC.id, excludeId) : undefined,
    ));
  return BigInt(rows[0]?.total ?? "0");
}

export async function findUCForTenant(tenantId: string, id: string): Promise<UCRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeUC)
    .where(and(eq(financeUC.tenantId, tenantId), eq(financeUC.id, id))).limit(1));
  return rows[0] ?? null;
}
