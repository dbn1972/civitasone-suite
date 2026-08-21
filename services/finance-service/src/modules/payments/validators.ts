import { z } from "zod";
import { PFMS_DDO_REGEX, PFMS_HOA_REGEX, PFMS_AGENCY_REGEX, PFMS_SCHEME_REGEX } from "../../shared/pfms.js";

const ddoCodeField = z.string().regex(PFMS_DDO_REGEX, "DDO code must be 6–12 alphanumeric characters (PFMS format)");

// BUG FIX: bigint-safe money fields, matching createBillBody.grossMinor's
// established pattern below. A plain z.number() caps out at 2^53 — a large
// value silently loses precision at the JSON.parse boundary BEFORE Zod ever
// sees it, and z.number().int() still accepts the (already wrong) rounded
// result since it's still an integer, just not the one that was sent.
// Two variants preserve each field's original positive-vs-nonnegative bound.
const moneyMinorField = z.union([
  z.string().regex(/^\d+$/, "must be a positive integer string").transform((s) => BigInt(s)),
  z.bigint().positive(),
]).pipe(z.bigint().positive());

const moneyMinorFieldNonNeg = z.union([
  z.string().regex(/^\d+$/, "must be a non-negative integer string").transform((s) => BigInt(s)),
  z.bigint().nonnegative(),
]).pipe(z.bigint().nonnegative());

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
  grossMinor:  z.union([
    z.string().regex(/^\d+$/, "grossMinor must be a positive integer string").transform(s => BigInt(s)),
    z.bigint().positive(),
  ]).pipe(z.bigint().positive()),
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
  amountMinor: z.union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/, "amountMinor must be a positive integer string"),
  ]),
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
  payee:       z.string().max(200).optional(),
  type:        z.enum(["employee", "vendor", "other"]).default("employee"),
  amountMinor: moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
});
export type CreateAdvanceBody = z.infer<typeof createAdvanceBody>;

export const createUCBody = z.object({
  ucNo:        z.string().min(1).max(64),
  purpose:     z.string().min(1).max(500),
  scheme:      z.string().max(200).optional(),
  grantRef:    z.string().max(200).optional(),
  amountMinor: moneyMinorField,
  currency:    z.string().length(3).default("INR"),
  periodFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodFrom must be YYYY-MM-DD").optional(),
  periodTo:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodTo must be YYYY-MM-DD").optional(),
});
export type CreateUCBody = z.infer<typeof createUCBody>;

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
