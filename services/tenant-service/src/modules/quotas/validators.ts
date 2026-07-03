/** zod validators for quota commands. */
import { z } from "zod";

export const quotaResourceValues = ["users", "storage_gb", "api_calls_daily", "documents"] as const;

export const quotaSetBody = z.object({
  tenantId: z.string().uuid(),
  resource: z.enum(quotaResourceValues),
  limit: z.number().int().min(0).max(100_000_000),
});
export type QuotaSetBody = z.infer<typeof quotaSetBody>;

export const quotaIncrementBody = z.object({
  tenantId: z.string().uuid(),
  resource: z.enum(quotaResourceValues),
  delta: z.number().int(), // can be negative for decrement
});
export type QuotaIncrementBody = z.infer<typeof quotaIncrementBody>;

export const quotaCheckBody = z.object({
  tenantId: z.string().uuid(),
  resource: z.enum(quotaResourceValues),
  requestedAmount: z.number().int().min(1).default(1),
});
export type QuotaCheckBody = z.infer<typeof quotaCheckBody>;

export const quotaIdParam = z.object({ quotaId: z.string().uuid() });
export const tenantIdParam = z.object({ tenantId: z.string().uuid() });
export const resourceParam = z.object({ resource: z.enum(quotaResourceValues) });
