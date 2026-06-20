import { z } from "zod";

export const recordPaymentBody = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amountMinor: z.number().int().min(1),
  gateway: z.string().default("razorpay"),
});
