import { z } from "zod";

const scopeToken = z.string().regex(/^(\*|[a-z][a-z0-9_]*):(\*|[a-z][a-z0-9_]*)$/, "scope must be 'resource:action'");

export const issueApiKeyBody = z.object({
  name:      z.string().min(1).max(200),
  scopes:    z.array(scopeToken).min(1).max(64),
  expiresAt: z.string().datetime().optional(),
});
export type IssueApiKeyBody = z.infer<typeof issueApiKeyBody>;

export const rotateApiKeyBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type RotateApiKeyBody = z.infer<typeof rotateApiKeyBody>;

export const revokeApiKeyBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});
export type RevokeApiKeyBody = z.infer<typeof revokeApiKeyBody>;

export const verifyApiKeyBody = z.object({
  key:           z.string().min(8).max(512),
  requiredScope: z.string().regex(/^(\*|[a-z][a-z0-9_]*):(\*|[a-z][a-z0-9_]*)$/).optional(),
});
export type VerifyApiKeyBody = z.infer<typeof verifyApiKeyBody>;

export const apiKeyIdParam = z.object({ id: z.string().uuid() });
export const listQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
