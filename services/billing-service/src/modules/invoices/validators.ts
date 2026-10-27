import { z } from "zod";
import { computeTotals, validateGstSplit, GSTIN_RE, HSN_SAC_RE } from "./domain.js";

export const generateBody = z.object({
  tenantId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  amountMinor: z.number().int().min(0),
  quantity: z.number().int().min(1).default(1),
  kind: z.enum(["line", "tax", "charge"]).default("line"),
  hsnSac: z.string().regex(HSN_SAC_RE, "HSN/SAC must be 4, 6 or 8 digits").optional(),
});

// Owner decision #26: supplier + recipient GSTIN, place of supply and the CGST/SGST/IGST split
// (integer paise, like every other amount on this body).
export const gstDetailSchema = z.object({
  supplierGstin: z.string().regex(GSTIN_RE, "invalid GSTIN"),
  recipientGstin: z.string().regex(GSTIN_RE, "invalid GSTIN"),
  placeOfSupply: z.string().regex(/^[0-9]{2}$/, "two-digit GST state code"),
  cgstMinor: z.number().int().min(0),
  sgstMinor: z.number().int().min(0),
  igstMinor: z.number().int().min(0),
});

export const createInvoiceBody = z.object({
  tenantId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(lineItemSchema).min(1),
  gst: gstDetailSchema.optional(),
}).superRefine((b, ctx) => {
  if (!b.gst) return;
  const err = validateGstSplit({
    supplierGstin: b.gst.supplierGstin, recipientGstin: b.gst.recipientGstin, placeOfSupply: b.gst.placeOfSupply,
    cgstMinor: BigInt(b.gst.cgstMinor), sgstMinor: BigInt(b.gst.sgstMinor), igstMinor: BigInt(b.gst.igstMinor),
  }, computeTotals(b.items).taxMinor);
  if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err, path: ["gst"] });
});
export type CreateInvoiceBody = z.infer<typeof createInvoiceBody>;

export const cancelBody = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelBody = z.infer<typeof cancelBody>;

export const approveBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type ApproveBody = z.infer<typeof approveBody>;

export const idParam = z.object({ id: z.string().uuid() });
export const approvalIdParam = z.object({ id: z.string().uuid(), approvalId: z.string().uuid() });
export const tenantParam = z.object({ id: z.string().uuid() });
