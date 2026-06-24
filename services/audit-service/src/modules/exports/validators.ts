import { z } from "zod";

// P1-5: maximum export window. Beyond this the request is rejected (bounded scans).
export const MAX_EXPORT_WINDOW_DAYS = Number(process.env.EXPORT_MAX_WINDOW_DAYS ?? 92);
// P1-5: hard cap on rows emitted into a single artifact.
export const MAX_EXPORT_ROWS = Number(process.env.EXPORT_MAX_ROWS ?? 50000);
// P1-5: roles allowed to bulk-export PII columns (ipAddress/userAgent/oldValue/newValue).
export const PII_EXPORT_ROLES = ["audit_admin", "super_admin", "platform_admin"];

export const createExportBody = z.object({
  from:   z.string().datetime(),
  to:     z.string().datetime(),
  format: z.enum(["json", "csv"]).default("json"),
  // P1-5: opt-in to PII columns; only honoured for PII_EXPORT_ROLES, rejected otherwise.
  includePii: z.boolean().default(false),
});
export type CreateExportBody = z.infer<typeof createExportBody>;
