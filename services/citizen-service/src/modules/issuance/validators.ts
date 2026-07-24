import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";

export const idParam = z.object({ id: z.string().uuid() });
export const tokenParam = z.object({ token: z.string().min(8).max(128) });

export const requestIssuanceBody = z.object({
  applicationId: z.string().uuid().optional(),
  certType:      safeText({ max: 48 }),
  subject:       z.record(z.unknown()).default({}),
  payload:       z.record(z.unknown()).default({}),
  validFrom:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RequestIssuanceBody = z.infer<typeof requestIssuanceBody>;

export const amendBody = z.object({
  payload: z.record(z.unknown()),
  note:    safeText({ max: 500, multiline: true }).optional(),
});
export type AmendBody = z.infer<typeof amendBody>;

export const renewBody = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note:      safeText({ max: 500, multiline: true }).optional(),
});
export type RenewBody = z.infer<typeof renewBody>;

export const revokeBody = z.object({
  action: z.enum(["cancel", "revoke"]),
  reason: safeText({ max: 500, multiline: true }).optional(),
});
export type RevokeBody = z.infer<typeof revokeBody>;
