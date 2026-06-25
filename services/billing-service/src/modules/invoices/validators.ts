import { z } from "zod";

export const generateBody = z.object({
  tenantId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  amountMinor: z.number().int().min(0),
  quantity: z.number().int().min(1).default(1),
  kind: z.enum(["line", "tax", "charge"]).default("line"),
});

export const createInvoiceBody = z.object({
  tenantId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(lineItemSchema).min(1),
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
