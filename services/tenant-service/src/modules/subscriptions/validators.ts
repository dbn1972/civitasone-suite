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
