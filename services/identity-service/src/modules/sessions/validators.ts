import { z } from "zod";

// CERT-In requirement: session idle timeout must not exceed 30 minutes (1800 seconds).
// Trusted (MFA-verified) device sessions may be extended to 8 hours (28800 seconds) by
// the caller, but non-trusted sessions MUST expire within 1800s to comply with CERT-In
// guidelines and the DPDP Act security requirements.
export const createSessionBody = z.object({
  tenantId:  z.string().uuid(),
  userId:    z.string().uuid(),
  ip:        z.string().max(45),
  device:    z.string().max(256).optional(),
  mfaMethod: z.string().max(32).optional(),
  trusted:   z.boolean().default(false),
  ttlSeconds: z.number().int().min(60).max(28800).default(1800),
});
export type CreateSessionBody = z.infer<typeof createSessionBody>;

export const sessionIdParam = z.object({ id: z.string().uuid() });
