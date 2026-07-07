/**
 * Request validators for multi-gateway payment routes.
 */

import { z } from "zod";

export const initiatePaymentBody = z.object({
  amountPaise: z.number().int().min(100, "minimum amount is 100 paise (1 INR)"),
  currency: z.string().length(3).default("INR"),
  invoiceId: z.string().uuid().optional(),
  subscriptionId: z.string().uuid().optional(),
  method: z.enum(["gateway", "upi_autopay", "emandate"]).default("gateway"),
  mandateId: z.string().max(128).optional(),
});

export const paymentIdParam = z.object({
  id: z.string().min(1).max(128),
});

export type InitiatePaymentBody = z.infer<typeof initiatePaymentBody>;
