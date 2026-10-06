import { z } from "zod";

export const createBindingBody = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  /** GAP-POLICY-BINDINGS-01: why the grant is made; carried into the audit payload. */
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type CreateBindingBody = z.infer<typeof createBindingBody>;

export const breakglassBody = z.object({
  scope:           z.string().min(1).max(256),
  reason:          z.string().min(10).max(2000),
  durationMinutes: z.number().int().min(1).max(1440).default(60),
});
export type BreakglassBody = z.infer<typeof breakglassBody>;

/** DELETE body: optional revocation reason (audited). */
export const revokeBindingBody = z.object({ reason: z.string().trim().min(1).max(2000).optional() }).default({});
export type RevokeBindingBody = z.infer<typeof revokeBindingBody>;

export const listBindingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bindingIdParam = z.object({ id: z.string().uuid() });
