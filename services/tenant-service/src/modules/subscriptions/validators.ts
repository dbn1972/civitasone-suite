/** zod validators for subscription commands. */
import { z } from "zod";

export const subscriptionStatusValues = ["trial", "active", "past_due", "suspended", "cancelled"] as const;

export const createSubscriptionBody = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
  startDate: z.string().datetime(),
  trialEndsAt: z.string().datetime().optional(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
});
export type CreateSubscriptionBody = z.infer<typeof createSubscriptionBody>;

export const upgradeSubscriptionBody = z.object({
  newPlanId: z.string().uuid(),
  effectiveDate: z.string().datetime().optional(),
});
export type UpgradeSubscriptionBody = z.infer<typeof upgradeSubscriptionBody>;

export const cancelSubscriptionBody = z.object({
  reason: z.string().min(3).max(500),
  immediate: z.boolean().default(false),
});
export type CancelSubscriptionBody = z.infer<typeof cancelSubscriptionBody>;

export const renewSubscriptionBody = z.object({
  newPeriodStart: z.string().datetime(),
  newPeriodEnd: z.string().datetime(),
});
export type RenewSubscriptionBody = z.infer<typeof renewSubscriptionBody>;

export const suspendSubscriptionBody = z.object({
  reason: z.string().min(3).max(500),
});
export type SuspendSubscriptionBody = z.infer<typeof suspendSubscriptionBody>;

export const subscriptionIdParam = z.object({ subscriptionId: z.string().uuid() });
export const tenantIdParam = z.object({ tenantId: z.string().uuid() });

// ── Self-service plan upgrade validators ─────────────────────────────────
export const upgradeInitiateBody = z.object({
  targetPlanId: z.string().uuid(),
  paymentMethod: z.enum(["razorpay", "bank_transfer"]).default("razorpay"),
});
export type UpgradeInitiateBody = z.infer<typeof upgradeInitiateBody>;

export const downgradeBody = z.object({
  targetPlanId: z.string().uuid(),
  acknowledgement: z.boolean().refine((v) => v === true, { message: "Must acknowledge data preservation notice" }),
});
export type DowngradeBody = z.infer<typeof downgradeBody>;

/** Owner decision #24: a downgrade request needs an acknowledgement AND a reason. */
export const downgradeRequestBody = z.object({
  targetPlanId: z.string().uuid(),
  acknowledgement: z.boolean().refine((v) => v === true, { message: "Must acknowledge data preservation notice" }),
  reason: z.string().trim().min(10).max(1000),
});
export type DowngradeRequestBody = z.infer<typeof downgradeRequestBody>;

export const downgradeDecisionBody = z.object({
  tenantId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(3).max(1000).optional(),
}).refine((v) => v.decision === "approve" || (v.reason !== undefined && v.reason.length >= 3), { message: "a reason is required to reject", path: ["reason"] });
export type DowngradeDecisionBody = z.infer<typeof downgradeDecisionBody>;

export const downgradeRequestIdParam = z.object({ requestId: z.string().uuid() });

export const cancelSubscriptionSelfBody = z.object({
  reason: z.string().min(3).max(500),
  feedback: z.string().max(2000).optional(),
});
export type CancelSubscriptionSelfBody = z.infer<typeof cancelSubscriptionSelfBody>;
