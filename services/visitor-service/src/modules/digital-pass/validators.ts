/**
 * visitor-service: digital-pass zod validators (routes.ts boundary).
 *
 * Validates path params and request bodies for the digital-pass routes
 * (GET /v1/visitor/passes/:id, POST /:id/revoke, POST /:id/replace).
 */
import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid("invalid pass id") });

export const passRevokeBody = z.object({
  reason: z.string().min(1, "reason is required").max(2000, "reason must be 2000 characters or fewer"),
});
export type PassRevokeBody = z.infer<typeof passRevokeBody>;

export const passReplaceBody = z.object({
  reason: z.string().min(1, "reason is required").max(2000, "reason must be 2000 characters or fewer"),
  tenantPrivateKeyPem: z.string().min(1, "tenantPrivateKeyPem is required"),
});
export type PassReplaceBody = z.infer<typeof passReplaceBody>;
