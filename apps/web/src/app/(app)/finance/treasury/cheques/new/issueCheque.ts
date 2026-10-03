import { rupeesToMinorString } from "@/lib/money";

/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: validation and payload for issuing a cheque / DD
 * (POST /v1/finance/instruments). Pure so the rules are unit-tested.
 */
export type IssueChequeForm = {
  instrumentType: string;
  instrumentNo: string;
  bankName: string;
  payee: string;
  amount: string;
  issueDate: string;
};

export type IssueChequeErrors = Partial<Record<"instrumentNo" | "bankName" | "payee" | "amount" | "issueDate", string>>;

/** Error keys (not copy), resolved to en/hi strings by the form. */
export function validateIssueCheque(f: IssueChequeForm, todayIso: string): IssueChequeErrors {
  const errors: IssueChequeErrors = {};
  if (!f.instrumentNo.trim()) errors.instrumentNo = "required";
  if (!f.bankName.trim()) errors.bankName = "required";
  if (!f.payee.trim()) errors.payee = "required";
  const minor = rupeesToMinorString(f.amount);
  if (minor === null || minor === "0" || !Number.isSafeInteger(Number(minor))) errors.amount = "amount";
  if (f.issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.issueDate)) errors.issueDate = "date";
  else if (f.issueDate && f.issueDate > todayIso) errors.issueDate = "future";
  return errors;
}

/** Request body. The API takes amountMinor as a JSON integer; validateIssueCheque guarantees it is a safe integer. */
export function issueChequePayload(f: IssueChequeForm): Record<string, unknown> {
  const minor = rupeesToMinorString(f.amount);
  return {
    instrumentType: f.instrumentType === "dd" ? "dd" : "cheque",
    instrumentNo: f.instrumentNo.trim(),
    bankName: f.bankName.trim(),
    payee: f.payee.trim(),
    amountMinor: Number(minor),
    currency: "INR",
    ...(f.issueDate ? { issueDate: f.issueDate } : {}),
  };
}
