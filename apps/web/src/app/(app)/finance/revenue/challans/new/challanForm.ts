import { rupeesToMinorString } from "@/lib/money";

/**
 * GAP-FINANCE-REVENUE-CHALLANS-06: validation and payload for recording a challan
 * (POST /v1/finance/challans). Pure so the rules are unit-tested.
 */
export type ChallanForm = { receiptHeadId: string; depositor: string; amount: string; grnNo: string };
export type ChallanErrors = Partial<Record<"receiptHeadId" | "depositor" | "amount", "required" | "amount">>;

export function validateChallan(f: ChallanForm): ChallanErrors {
  const e: ChallanErrors = {};
  if (!f.receiptHeadId) e.receiptHeadId = "required";
  if (!f.depositor.trim()) e.depositor = "required";
  const minor = rupeesToMinorString(f.amount);
  if (minor === null || !Number.isSafeInteger(Number(minor))) e.amount = "amount";
  return e;
}

/**
 * The challan number is allocated by finance-service from its gapless CHLN series, so the form
 * never asks for one; the API still requires the field, and ignores the value.
 */
export function challanPayload(f: ChallanForm): Record<string, unknown> {
  return {
    challanNo: "AUTO",
    receiptHeadId: f.receiptHeadId,
    depositor: f.depositor.trim(),
    amountMinor: Number(rupeesToMinorString(f.amount)),
    currency: "INR",
    ...(f.grnNo.trim() ? { grnNo: f.grnNo.trim() } : {}),
  };
}
