import { z } from "zod";

export const tenantIdParam = z.object({ id: z.string().uuid() });
export const moduleParam = z.object({ id: z.string().uuid(), module: z.string().min(1) });
export const moduleKeyParam = z.object({ key: z.string().min(1).max(128) });
export const toggleBody = z.object({
  enabled: z.boolean(),
  // GAP-TENANT-ADMIN-SETTINGS-02: an audited reason for enabling/disabling a
  // module (disabling cuts tenant-wide access). Optional + capped so existing
  // callers keep working; when present it is written into the audit event.
  reason: z.string().trim().min(1).max(500).optional(),
});

export const createFlagBody = z.object({
  flagKey: z.string().min(1).max(128),
  enabled: z.boolean().default(false),
});

export const overrideFlagBody = z.object({
  tenantId: z.string().uuid(),
  enabled: z.boolean(),
});

export const flagKeyParam = z.object({ key: z.string().min(1) });
