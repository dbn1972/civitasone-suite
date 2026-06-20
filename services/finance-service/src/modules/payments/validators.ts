import { z } from "zod";

const deduction = z.object({
  type:        z.string().min(1),
  amountMinor: z.number().int().nonnegative(),
  description: z.string().optional(),
});

export const createBillBody = z.object({
  billNo:      z.string().min(1).max(64),
  vendorId:    z.string().uuid(),
  headId:      z.string().uuid(),
  sanctionRef: z.string().uuid().optional(),
  grossMinor:  z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  deductions:  z.array(deduction).default([]),
  poRef:       z.string().optional(),
  grnRef:      z.string().optional(),
});
export type CreateBillBody = z.infer<typeof createBillBody>;

export const approveBillBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveBillBody = z.infer<typeof approveBillBody>;

export const initiateEftBody = z.object({
  billId:      z.string().uuid(),
  mode:        z.enum(["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"]),
  amountMinor: z.number().int().positive(),
  currency:    z.string().length(3).default("INR"),
  eftRef:      z.string().optional(),
});
export type InitiateEftBody = z.infer<typeof initiateEftBody>;

export const gemInvoiceMatchBody = z.object({
  poRef:      z.string().min(1),
  invoiceRef: z.string().min(1),
  amountMinor: z.number().int().positive(),
});
export type GemInvoiceMatchBody = z.infer<typeof gemInvoiceMatchBody>;

export const idParam = z.object({ id: z.string().uuid() });
