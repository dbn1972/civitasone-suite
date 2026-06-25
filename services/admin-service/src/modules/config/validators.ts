import { z } from "zod";

export const tenantIdParam = z.object({ id: z.string().uuid() });
export const moduleParam = z.object({ id: z.string().uuid(), module: z.string().min(1) });
export const moduleKeyParam = z.object({ key: z.string().min(1).max(128) });
export const toggleBody = z.object({ enabled: z.boolean() });

export const createFlagBody = z.object({
  flagKey: z.string().min(1).max(128),
  enabled: z.boolean().default(false),
});

export const overrideFlagBody = z.object({
  tenantId: z.string().uuid(),
  enabled: z.boolean(),
});

export const flagKeyParam = z.object({ key: z.string().min(1) });
