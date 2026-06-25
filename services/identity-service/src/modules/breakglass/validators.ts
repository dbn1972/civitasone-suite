import { z } from "zod";

export const grantBody = z.object({
  userId:     z.string().uuid(),
  reason:     z.string().min(10).max(500),
  scope:      z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.:-]*$/, "lowercase scope token"),
  ttlMinutes: z.coerce.number().int().min(5).max(240),
});
export type GrantBody = z.infer<typeof grantBody>;

export const closeBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type CloseBody = z.infer<typeof closeBody>;

export const grantIdParam = z.object({ id: z.string().uuid() });
export const listQuery = z.object({
  status: z.enum(["active", "closed", "expired"]).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
