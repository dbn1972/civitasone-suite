import { z } from "zod";
import { PFMS_DDO_REGEX, PFMS_HOA_REGEX, PFMS_AGENCY_REGEX, PFMS_SCHEME_REGEX } from "../../shared/pfms.js";

const ddoCodeField = z.string().regex(PFMS_DDO_REGEX, "DDO code must be 6–12 alphanumeric characters (PFMS format)");

const deduction = z.object({
  type:        z.string().min(1),
  amountMinor: z.number().int().nonnegative(),
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
  grossMinor:  z.number().int().positive(),
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
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  eftRef:      z.string().optional(),
  bankAccountId: z.string().uuid().optional(),
});
export type InitiateEftBody = z.infer<typeof initiateEftBody>;

export const gemInvoiceMatchBody = z.object({
  poRef:      z.string().min(1),
  invoiceRef: z.string().min(1),
  amountMinor: z.number().int().positive(),
});
export type GemInvoiceMatchBody = z.infer<typeof gemInvoiceMatchBody>;

export const createAdvanceBody = z.object({
  advanceNo:   z.string().min(1).max(64),
  purpose:     z.string().min(1).max(500),
  payee:       z.string().max(200).optional(),
  type:        z.enum(["employee", "vendor", "other"]).default("employee"),
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  dueDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
});
export type CreateAdvanceBody = z.infer<typeof createAdvanceBody>;

export const createUCBody = z.object({
  ucNo:        z.string().min(1).max(64),
  purpose:     z.string().min(1).max(500),
  scheme:      z.string().max(200).optional(),
  grantRef:    z.string().max(200).optional(),
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  periodFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodFrom must be YYYY-MM-DD").optional(),
  periodTo:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "periodTo must be YYYY-MM-DD").optional(),
});
export type CreateUCBody = z.infer<typeof createUCBody>;

export const idParam = z.object({ id: z.string().uuid() });
