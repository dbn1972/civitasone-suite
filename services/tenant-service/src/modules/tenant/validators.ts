/** zod validators — applied at the route boundary (CLAUDE.md §3: no raw req.body). */
import { z } from "zod";

export const createTenantBody = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i, "invalid domain"),
  edition: z.enum(["small_office", "psu", "govt"]),
  region: z.string().min(2).max(64),
  residency: z.string().min(2).max(64),
});
export type CreateTenantBody = z.infer<typeof createTenantBody>;

export const updateTenantBody = z.object({
  name: z.string().min(2).max(200).optional(),
  settings: z.record(z.unknown()).optional(),
}).refine((b) => b.name !== undefined || b.settings !== undefined, {
  message: "at least one of name, settings is required",
});
export type UpdateTenantBody = z.infer<typeof updateTenantBody>;

export const suspendTenantBody = z.object({
  reason: z.string().min(3).max(500),
});
export type SuspendTenantBody = z.infer<typeof suspendTenantBody>;

export const tenantIdParam = z.object({ tenantId: z.string().uuid() });

export const onboardTenantBody = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i, "invalid domain"),
  edition: z.enum(["small_office", "psu", "govt"]),
  region: z.string().min(2).max(64),
  residency: z.string().min(2).max(64),
  adminEmail: z.string().email().max(254),
  adminName: z.string().min(2).max(200),
});
export type OnboardTenantBody = z.infer<typeof onboardTenantBody>;
