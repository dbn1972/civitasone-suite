/**
 * UAT L2-N6 review: GRNI clearing on the ACCRUAL basis.
 *
 * A GRN stock receipt books Dr Stores / Cr GRNI. The bill drafted from the accepted GRN is a normal budget bill: it
 * is validated and committed against its budget head (HoA, allocation) and, when passed, books Dr <bill head> / Cr
 * AP (payments/consumer.ts) -- unchanged, so budget control is not touched. For the stocked value this clearing then
 * books Dr GRNI / Cr <bill head>, so that the net effect is the GRN bill debiting GRNI for the stocked items: GRNI
 * nets to 0, the expense is recognised on issue, AP carries the bill.
 *
 * It posts once BOTH exist -- the accrual GRN receipt(s) (gl.stores_valuation_memo with their journal) and a passed /
 * paid bill for that GRN (grn_ref procurement_grn:<id>) -- whichever arrives second triggers it (called from the
 * inventory_movement branch and from the bill-pass step). Journal id is deterministic (grni_clear:<grn>), voucher
 * AUTO: calling it twice posts once. Amount = the stocked value received (what GRNI holds); a bill price difference
 * stays on the bill head as expenditure.
 */
import { and, eq, inArray } from "drizzle-orm";
import { enqueueSpineJournal } from "./spine.js";
import { GRNI } from "./system-heads.js";
import { grnReceiptTotalTx } from "./stores-memo.js";
import { financeBills } from "../payments/schema.js";
import { todayIST } from "../../shared/ist-date.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type GrniClearingOutcome = "enqueued" | "waiting_for_receipt" | "waiting_for_bill";

export async function clearGrniTx(
  tx: Tx, ctx: { tenantId: string; actorId: string; correlationId: string }, grnId: string,
): Promise<GrniClearingOutcome> {
  const receipt = await grnReceiptTotalTx(tx, ctx.tenantId, grnId);
  if (receipt.totalMinor <= 0n) return "waiting_for_receipt";
  const bills = await tx.select({ headId: financeBills.headId, billDate: financeBills.billDate }).from(financeBills).where(and(
    eq(financeBills.tenantId, ctx.tenantId), eq(financeBills.grnRef, `procurement_grn:${grnId}`),
    inArray(financeBills.status, ["passed", "paid"]),
  )).limit(1) as Array<{ headId: string; billDate: string | null }>;
  const bill = bills[0];
  if (!bill) return "waiting_for_bill";
  const dates = [bill.billDate, receipt.postingDate].filter((d): d is string => !!d).sort();
  const postingDate = dates.at(-1) ?? todayIST();
  await enqueueSpineJournal(tx, {
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    sourceKey: `grni_clear:${grnId}`, type: "inventory_movement", postingDate,
    lines: [
      { accountCode: GRNI, debitMinor: receipt.totalMinor, creditMinor: 0n, narration: `GRNI cleared by the bill of GRN ${grnId}` },
      { accountCode: bill.headId, debitMinor: 0n, creditMinor: receipt.totalMinor, narration: `Stocked value of GRN ${grnId} to stores` },
    ],
  });
  return "enqueued";
}
