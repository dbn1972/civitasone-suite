/** zod validators for role-features commands. */
import { z } from "zod";

export const grantFeatureBody = z.object({
  roleName: z.string().min(1).max(100),
  featureKey: z.string().min(1).max(200),
  granted: z.boolean().default(true),
});
export type GrantFeatureBody = z.infer<typeof grantFeatureBody>;

export const roleParam = z.object({ role: z.string().min(1).max(100) });
export const grantIdParam = z.object({ id: z.string().uuid() });

export const evaluateQuery = z.object({
  roles: z.string().min(1).transform((v) => v.split(",").map((r) => r.trim()).filter(Boolean)),
});
export type EvaluateQuery = z.infer<typeof evaluateQuery>;
