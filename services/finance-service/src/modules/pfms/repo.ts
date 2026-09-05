import { eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePfms } from "../payments/schema.js";
import { financePfmsConfig } from "./schema.js";

export type BeneficiaryRow = {
  beneficiary: string;
  account: string;
  ifsc: string;
  amountMinor: bigint;
  ref: string;
  ddoCode: string | null;
};

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPfmsBatch(tx: Writer, row: typeof financePfms.$inferInsert): Promise<void> {
  await tx.insert(financePfms).values(row);
}

export async function findPfmsById(id: string, tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1));
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

/**
 * Tx-scoped variant of findPfmsById: reads through the caller's already-open
 * transaction instead of opening a nested one via scopedRead. finance.pfms.
 * batch_sign / batch_submit call this from inside their own db.transaction();
 * the scopedRead-based findPfmsById would open a second, nested transaction
 * competing for an extra pool connection while the outer one is already
 * held — under load (pool.max concurrent in-flight commands) that deadlocks.
 */
export async function findPfmsByIdTx(tx: Writer, id: string, tenantId: string) {
  const rows = await (tx as typeof db).select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

export async function listPfmsByTenant(tenantId: string, limit = 50) {
  return scopedRead((tx) => tx.select().from(financePfms)
    .where(eq(financePfms.tenantId, tenantId))
    .limit(limit));
}

export async function getTenantConfig(tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePfmsConfig)
    .where(eq(financePfmsConfig.tenantId, tenantId))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of getTenantConfig: reads through the caller's already-
 * open transaction instead of opening a nested one via scopedRead.
 * integrations/consumer.ts's PFMS-initiate handler calls this from inside
 * its own db.transaction() (the actual EFT-initiation path) -- see
 * findPfmsByIdTx above for the pool-exhaustion deadlock this avoids.
 */
export async function getTenantConfigTx(tx: Writer, tenantId: string) {
  const rows = await (tx as typeof db).select().from(financePfmsConfig)
    .where(eq(financePfmsConfig.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Real NEFT beneficiaries for a tenant's PFMS bank file, built from actual
 * payments.finance_payments rows (NOT a hardcoded stub):
 *   - amount        : the real payment amount_minor (PAISE bigint)
 *   - ref           : the real UTR / EFT ref (falls back to payment id)
 *   - beneficiary   : resolved vendor name via the bill's vendor_id
 *   - account       : the real bank account_no when bank_account_id is set
 *   - ddoCode       : the real payment/bill DDO
 * IFSC is not captured in finance-service's schema (no beneficiary bank master),
 * so it is emitted blank rather than fabricated — see route documentation.
 * Only releasable payments are listed (status in initiated/released/completed).
 */
export async function listRealBeneficiaries(tenantId: string, pfmsId: string, limit = 500): Promise<BeneficiaryRow[]> {
  // H1: scope strictly to the batch's own payment set (p.pfms_id = the batch's
  // pfms_id) instead of every tenant payment. Also tenant-scope the bank/bill
  // joins so a payment can never resolve another tenant's bank/bill row.
  const rows = await scopedRead((tx) => tx.execute<{
    beneficiary: string | null; account: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>(sql`
    SELECT
      COALESCE(p.vendor_ref, '') AS beneficiary,
      p.bank_account_ref                   AS account,
      p.amount_minor::text                 AS amount_minor,
      COALESCE(p.utr, p.eft_ref, p.id::text) AS ref,
      COALESCE(p.ddo_code, p.ddo_code_denorm) AS ddo_code
    FROM payments.finance_payments p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.pfms_id = ${pfmsId}
      AND p.status IN ('initiated','released','completed')
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `));
  const arr = rows as unknown as Array<{
    beneficiary: string | null; account: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>;
  return arr.map((r) => ({
    beneficiary: r.beneficiary ?? "",
    account: r.account ?? "",
    ifsc: "",
    amountMinor: BigInt(r.amount_minor),
    ref: r.ref,
    ddoCode: r.ddo_code,
  }));
}

export async function updatePfmsBatch(tx: Writer, id: string, patch: Partial<typeof financePfms.$inferInsert>): Promise<void> {
  await tx.update(financePfms).set({ ...patch, updatedAt: new Date() }).where(eq(financePfms.id, id));
}
