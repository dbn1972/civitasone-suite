/** zod validators — applied at the route boundary (CLAUDE.md §3: no raw req.body). */
import { z } from "zod";

export const createTenantBody = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i, "invalid domain"),
  edition: z.enum(["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"]),
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

export const setIsolationBody = z.object({
  tier:      z.enum(["pool", "silo"]),
  dbDsnRef:  z.string().min(1).max(512).nullable().optional(),  // secrets-manager reference
  kmsKeyRef: z.string().min(1).max(512).nullable().optional(),
}).refine((b) => b.tier === "pool" || !!b.dbDsnRef, {
  message: "silo tier requires dbDsnRef (the dedicated DB secret reference)",
  path: ["dbDsnRef"],
});
export type SetIsolationBody = z.infer<typeof setIsolationBody>;

export const onboardTenantBody = z.object({
  name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i, "invalid domain"),
  edition: z.enum(["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"]),
  region: z.string().min(2).max(64),
  residency: z.string().min(2).max(64),
  adminEmail: z.string().email().max(254),
  adminName: z.string().min(2).max(200),
});
export type OnboardTenantBody = z.infer<typeof onboardTenantBody>;

export const updateQuotasBody = z.object({
  maxEmployees: z.number().int().min(1).max(1_000_000).optional(),
  maxFiles: z.number().int().min(1).max(100_000_000).optional(),
  maxApiCallsPerMin: z.number().int().min(1).max(100_000).optional(),
  maxStorageGb: z.number().int().min(1).max(100_000).optional(),
  maxUsers: z.number().int().min(1).max(1_000_000).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), {
  message: "at least one quota field must be provided",
});
export type UpdateQuotasBody = z.infer<typeof updateQuotasBody>;


export const msmeOnboardBody = z.object({
  udyamNumber:  z.string().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, "Invalid Udyam number format (UDYAM-XX-XX-XXXXXXX)"),
  businessName: z.string().min(2).max(200),
  ownerName:    z.string().min(2).max(200),
  email:        z.string().email().max(254),
  mobile:       z.string().min(10).max(15).optional(),
  category:     z.enum(["micro", "small", "medium"]),
  sector:       z.enum(["manufacturing", "trading", "services"]),
  nicCode:      z.string().min(2).max(5).optional(),
  gstin:        z.string().length(15).optional(),
  state:        z.string().min(2).max(64).optional(),
});
export type MsmeOnboardBody = z.infer<typeof msmeOnboardBody>;
