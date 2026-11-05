/**
 * UAT T-PERIOD D-02 (ERP-head decision 2026-11-05): depreciation that is computed and kept for the registers but is
 * NOT a GL charge (migration 0161, gl.depreciation_memo):
 *  - the income-tax (statutory WDV) book ALWAYS -- it is a memorandum for the tax computation / tax depreciation
 *    register, never a second charge to the accumulated depreciation head (it was posted Dr 5101 / Cr 1250 next to
 *    the company book, double-charging depreciation);
 *  - the company book too for a CASH-basis tenant (government accounts: the asset register is a memorandum).
 * Only an ACCRUAL tenant posts the company-book depreciation (Dr 5100 / Cr 1250).
 * Idempotent by (tenant, asset, period, book): a redelivery records nothing new.
 */
import { sql } from "drizzle-orm";

export type DepreciationMemo = {
  tenantId: string; assetId: string; period: string; depBook: "company" | "statutory";
  amountMinor: bigint; basis: "cash" | "accrual"; reason: "income_tax_memorandum" | "cash_basis_memorandum"; actorId: string;
};

/** Why a depreciation entry is a memorandum, or null when it is posted to the GL. Pure. */
export function depreciationMemoReason(depBook: string, basis: "cash" | "accrual"): DepreciationMemo["reason"] | null {
  if (depBook === "statutory") return "income_tax_memorandum";
  if (basis === "cash") return "cash_basis_memorandum";
  return null;
}

/** Record the memorandum entry in the caller transaction. Returns false when it was already recorded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordDepreciationMemoTx(tx: any, m: DepreciationMemo): Promise<boolean> {
  const rows = await tx.execute(sql`
    INSERT INTO gl.depreciation_memo (tenant_id, asset_id, period, dep_book, amount_minor, basis, reason, created_by)
    VALUES (${m.tenantId}::uuid, ${m.assetId}::uuid, ${m.period}, ${m.depBook}, ${m.amountMinor.toString()}::bigint, ${m.basis}, ${m.reason}, ${m.actorId}::uuid)
    ON CONFLICT (tenant_id, asset_id, period, dep_book) DO NOTHING
    RETURNING asset_id
  `);
  return (rows as unknown as unknown[]).length > 0;
}
