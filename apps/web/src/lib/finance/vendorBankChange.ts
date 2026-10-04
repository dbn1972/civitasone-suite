/** Pure validation for the vendor bank-detail change request (mirrors finance-service's bankChangeBody). */
export type BankChangeForm = { bankName: string; bankAccount: string; ifsc: string; reason: string };
export type BankChangeErrorKey = "bankNameRequired" | "bankAccountInvalid" | "ifscInvalid" | "reasonTooShort" | "sameDetails";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateBankChange(
  f: BankChangeForm,
): { ok: true; body: { bankName: string; bankAccount: string; ifsc: string; reason: string } } | { ok: false; errors: Partial<Record<keyof BankChangeForm, BankChangeErrorKey>> } {
  const errors: Partial<Record<keyof BankChangeForm, BankChangeErrorKey>> = {};
  const bankName = f.bankName.trim();
  const bankAccount = f.bankAccount.replace(/\s+/g, "");
  const ifsc = f.ifsc.trim().toUpperCase();
  const reason = f.reason.trim();
  if (bankName.length < 2) errors.bankName = "bankNameRequired";
  if (bankAccount.length < 5 || bankAccount.length > 30 || !/^[A-Za-z0-9]+$/.test(bankAccount)) errors.bankAccount = "bankAccountInvalid";
  if (!IFSC_RE.test(ifsc)) errors.ifsc = "ifscInvalid";
  if (reason.length < 5) errors.reason = "reasonTooShort";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { bankName, bankAccount, ifsc, reason } };
}
