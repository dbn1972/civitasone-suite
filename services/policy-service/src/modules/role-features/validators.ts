/** zod validators for role-features commands. */
import { z } from "zod";

/**
 * Q28: every grant and revoke carries an auditable reason (min 5 chars after
 * trimming). Required at the API, not just prompted by the matrix UI.
 */
export const MIN_REASON_LENGTH = 5;
const reason = z.string().trim().min(MIN_REASON_LENGTH, `reason must be at least ${MIN_REASON_LENGTH} characters`).max(500);

export const grantFeatureBody = z.object({
  roleName: z.string().min(1).max(100),
  featureKey: z.string().min(1).max(200),
  granted: z.boolean().default(true),
  reason,
});
export type GrantFeatureBody = z.infer<typeof grantFeatureBody>;

export const roleParam = z.object({ role: z.string().min(1).max(100) });
/** DELETE body: the audited reason for the revocation (required, persisted with the revoke). */
export const revokeFeatureBody = z.object({ reason });
export type RevokeFeatureBody = z.infer<typeof revokeFeatureBody>;

export const grantIdParam = z.object({ id: z.string().uuid() });

export const evaluateQuery = z.object({
  roles: z.string().min(1).transform((v) => v.split(",").map((r) => r.trim()).filter(Boolean)),
});
export type EvaluateQuery = z.infer<typeof evaluateQuery>;
