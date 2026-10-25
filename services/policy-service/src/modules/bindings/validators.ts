import { z } from "zod";

export const createBindingBody = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  /** Q28: why the grant is made (required, min 5 chars); carried into the audit payload. */
  reason: z.string().trim().min(5, "reason must be at least 5 characters").max(2000),
});
export type CreateBindingBody = z.infer<typeof createBindingBody>;

export const breakglassBody = z.object({
  scope:           z.string().min(1).max(256),
  reason:          z.string().min(10).max(2000),
  durationMinutes: z.number().int().min(1).max(1440).default(60),
});
export type BreakglassBody = z.infer<typeof breakglassBody>;

/** DELETE body: revocation reason (required, min 5 chars; audited). */
export const revokeBindingBody = z.object({ reason: z.string().trim().min(5, "reason must be at least 5 characters").max(2000) });
export type RevokeBindingBody = z.infer<typeof revokeBindingBody>;

export const listBindingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bindingIdParam = z.object({ id: z.string().uuid() });
