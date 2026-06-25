import { z } from "zod";

export const recordPaymentBody = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amountMinor: z.number().int().min(1),
  method: z.string().min(1).max(32).default("gateway"),
  reference: z.string().max(200).optional(),
  gateway: z.string().default("razorpay"),
});
export type RecordPaymentBody = z.infer<typeof recordPaymentBody>;

export const tenantParam = z.object({ id: z.string().uuid() });
export const invoiceParam = z.object({ id: z.string().uuid() });
