import { z } from "zod";

export const checkoutBody = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "annual"]),
});
export type CheckoutBody = z.infer<typeof checkoutBody>;

export const verifyPaymentBody = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyPaymentBody = z.infer<typeof verifyPaymentBody>;
