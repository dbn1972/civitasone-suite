import { REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES } from "@civitasone/types";

/**
 * GAP-PAYROLL-REIMBURSEMENTS-03: reimbursement receipt rules shared by the
 * claim form. Mirrors payroll-service (modules/payroll/fin03-domain.ts):
 * PDF / JPEG / PNG, at most 10 MB each and 5 per claim.
 */
export const RECEIPT_MAX_FILES = 5;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const RECEIPT_ACCEPT = RECEIPT_TYPES.join(",");

/**
 * Categories whose claims need supporting documents (medical bills, LTA
 * tickets, travel tickets / vouchers): the SAME list payroll-service enforces
 * (route + consumer), shared from @civitasone/types so they cannot drift.
 */
export const RECEIPT_REQUIRED_CATEGORIES: readonly string[] = REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES;

export function receiptRequired(category: string): boolean {
  return RECEIPT_REQUIRED_CATEGORIES.includes(category);
}

export type ReceiptProblem = "type" | "size" | "limit" | null;

/** Why a picked file cannot be attached, or null when it can. */
export function receiptProblem(file: { type: string; size: number }, alreadyAttached: number): ReceiptProblem {
  if (alreadyAttached >= RECEIPT_MAX_FILES) return "limit";
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size <= 0 || file.size > RECEIPT_MAX_BYTES) return "size";
  return null;
}
