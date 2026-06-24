import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
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
  const rows = await db.select().from(financePfms)
    .where(eq(financePfms.id, id))
    .limit(1);
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}

export async function listPfmsByTenant(tenantId: string, limit = 50) {
  return db.select().from(financePfms)
    .where(eq(financePfms.tenantId, tenantId))
    .limit(limit);
}

export async function getTenantConfig(tenantId: string) {
  const rows = await db.select().from(financePfmsConfig)
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
export async function listRealBeneficiaries(tenantId: string, limit = 500): Promise<BeneficiaryRow[]> {
  const rows = await db.execute<{
    beneficiary: string | null; account: string | null; amount_minor: string;
    ref: string; ddo_code: string | null;
  }>(sql`
    SELECT
      COALESCE(b.vendor_id::text, '') AS beneficiary,
      bk.account_no                    AS account,
      p.amount_minor::text             AS amount_minor,
      COALESCE(p.utr, p.eft_ref, p.id::text) AS ref,
      COALESCE(p.ddo_code, b.ddo_code) AS ddo_code
    FROM payments.finance_payments p
    LEFT JOIN payments.finance_bills b ON b.id = p.bill_id
    LEFT JOIN treasury.finance_banks bk ON bk.id = p.bank_account_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.status IN ('initiated','released','completed')
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `);
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
