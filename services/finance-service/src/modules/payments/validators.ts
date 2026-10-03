import { z } from "zod";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";
import { PFMS_DDO_REGEX, PFMS_HOA_REGEX, PFMS_AGENCY_REGEX, PFMS_SCHEME_REGEX } from "../../shared/pfms.js";

const ddoCodeField = z.string().regex(PFMS_DDO_REGEX, "DDO code must be 6–12 alphanumeric characters (PFMS format)");

// BUG FIX: bigint-safe money fields, matching createBillBody.grossMinor's
// established pattern below. A plain z.number() caps out at 2^53 — a large
// value silently loses precision at the JSON.parse boundary BEFORE Zod ever
// sees it, and z.number().int() still accepts the (already wrong) rounded
// result since it's still an integer, just not the one that was sent.
// Two variants preserve each field's original positive-vs-nonnegative bound.
// FIX: was a hand-rolled union missing a z.number() branch, so any plain
// JSON-number payload (the common case) 400'd. zMoneyMinorBase is the
// canonical @civitasone/schemas/money decoder — accepts string | safe-integer
// number | bigint and rejects unsafe (>2^53) numbers, forcing those onto the
// string path instead of silently losing precision.
const moneyMinorField = zMoneyMinorBase.pipe(z.bigint().positive());
const moneyMinorFieldNonNeg = zMoneyMinorBase.pipe(z.bigint().nonnegative());

const deduction = z.object({
  type:        z.string().min(1),
  amountMinor: moneyMinorFieldNonNeg,
  description: z.string().optional(),
});

export const createBillBody = z.object({
  billNo:      z.string().min(1).max(64),
  vendorId:    z.string().uuid(),
  headId:      z.string().uuid(),
  ddoCode:     ddoCodeField,
  paoCode:     z.string().regex(/^[A-Za-z0-9]{4,12}$/, "PAO code 4–12 alphanumeric").optional(),
  agencyCode:  z.string().regex(PFMS_AGENCY_REGEX, "agency code 4–12 alphanumeric").optional(),
  schemeCode:  z.string().regex(PFMS_SCHEME_REGEX, "scheme code 4–20 alphanumeric").optional(),
  sanctionRef: z.string().uuid().optional(),
  // M2: accept string-encoded bigint to avoid 2^53 JSON precision loss on large
  // government bill amounts. Legacy number payloads still accepted via union.
  grossMinor:  moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  deductions:  z.array(deduction).default([]),
  poRef:       z.string().optional(),
  grnRef:      z.string().optional(),
  billDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "billDate must be YYYY-MM-DD").optional(),
});
export type CreateBillBody = z.infer<typeof createBillBody>;

export const approveBillBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveBillBody = z.infer<typeof approveBillBody>;

export const initiateEftBody = z.object({
  billId:      z.string().uuid(),
  ddoCode:     ddoCodeField,
  mode:        z.enum(["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"]),
  // C3 FIX: use string-encoded bigint to avoid 2^53 precision loss.
  // The consumer validates amountMinor === bill.netMinor (conservation invariant).
  // BUG FIX: was a hand-rolled z.union([z.number().int().positive(), z.string()...])
  // with NO safe-integer bound on the number branch, so an already-precision-lost
  // JSON number above 2^53 was silently accepted on this bank-transfer initiation
  // route. Reuse moneyMinorField (the canonical zMoneyMinor decoder, already used
  // by every other amountMinor field in this file) instead. consumer.ts's
  // paymentInitiate schema union was extended to accept the resulting bigint
  // payload (it previously only allowed string|number, matching this old shape).
  amountMinor: moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  eftRef:      z.string().optional(),
  bankAccountId: z.string().uuid().optional(),
});
export type InitiateEftBody = z.infer<typeof initiateEftBody>;

export const gemInvoiceMatchBody = z.object({
  poRef:      z.string().min(1),
  invoiceRef: z.string().min(1),
  amountMinor: moneyMinorField,
});
export type GemInvoiceMatchBody = z.infer<typeof gemInvoiceMatchBody>;

export const createAdvanceBody = z.object({
  advanceNo:   z.string().min(1).max(64),
  purpose:     z.string().min(1).max(500),
  // Required: the beneficiary column is NOT NULL and must never be back-filled
  // from the free-text purpose (which can name a person; DPDP masking).
  payee:       z.string().trim().min(1).max(200),
  type:        z.enum(["employee", "vendor", "other"]).default("employee"),
  amountMinor: moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01: an advance is an outward commitment of
  // public money, so the sanctioning authority and the reason are recorded with it.
  sanctionAuthority: z.string().trim().min(2, "Name the sanctioning authority").max(200),
  reason:      z.string().trim().min(5, "Give the reason for this advance (at least 5 characters)").max(500),
});
export type CreateAdvanceBody = z.infer<typeof createAdvanceBody>;

export const createUCBody = z.object({
  ucNo:        z.string().min(1).max(64),
  purpose:     z.string().min(1).max(500),
  scheme:      z.string().max(200).optional(),
  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02: the body that utilised the grant.
  grantee:     z.string().trim().min(2, "Name the grantee").max(200),
  grantRef:    z.string().max(200).optional(),
  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-01: the certifier attests the
  // grant was utilised for the sanctioned purpose; recorded with who and when.
  declaration: z.literal(true, { errorMap: () => ({ message: "The utilisation declaration must be accepted" }) }),
  amountMinor: moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  periodFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodFrom must be YYYY-MM-DD").optional(),
  periodTo:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodTo must be YYYY-MM-DD").optional(),
});
export type CreateUCBody = z.infer<typeof createUCBody>;

export const rejectUCBody = z.object({
  reason: z.string().trim().min(5, "Say why this certificate is returned (at least 5 characters)").max(500),
});
export const resubmitUCBody = z.object({
  note: z.string().trim().max(500).optional(),
});

export const adjustAdvanceBody = z.object({
  adjustedMinor: moneyMinorField,
  reason:        z.string().min(3).max(500),
});
export type AdjustAdvanceBody = z.infer<typeof adjustAdvanceBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const rejectBillBody = z.object({
  reason: z.string().min(3).max(500),
});
export type RejectBillBody = z.infer<typeof rejectBillBody>;
