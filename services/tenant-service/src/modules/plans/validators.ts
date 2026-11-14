/** zod validators — applied at the route boundary. */
import { z } from "zod";
import { resolveModules, type ResolutionResult } from "@civitasone/schemas/module-resolver";
import { CATALOGUE_BY_ID } from "@civitasone/schemas/module-catalogue";

export const editionValues = ["small_office", "psu", "govt_dept"] as const;
export const billingCycleValues = ["monthly", "quarterly", "annual"] as const;

/** M6: catalogue module ids a plan is sold as. */
const catalogueModuleIds = z.array(z.string().min(1).max(64)).max(128).superRefine((ids, ctx) => {
  for (const id of ids) {
    if (!CATALOGUE_BY_ID.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown catalogue module: ${id}` });
  }
});

export const createPlanBody = z.object({
  code: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/, "lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(2).max(200),
  edition: z.enum(editionValues),
  maxUsers: z.number().int().min(1).max(1_000_000),
  maxStorageGb: z.number().int().min(1).max(100_000),
  enabledModules: z.array(z.string().min(1).max(64)).default([]),
  catalogueModules: catalogueModuleIds.nullable().default(null),
  priceMinor: z.number().int().min(0),
  billingCycle: z.enum(billingCycleValues).default("annual"),
  features: z.record(z.unknown()).default({}),
});
export type CreatePlanBody = z.infer<typeof createPlanBody>;

export const updatePlanBody = z.object({
  name: z.string().min(2).max(200).optional(),
  maxUsers: z.number().int().min(1).max(1_000_000).optional(),
  maxStorageGb: z.number().int().min(1).max(100_000).optional(),
  enabledModules: z.array(z.string().min(1).max(64)).optional(),
  catalogueModules: catalogueModuleIds.nullable().optional(),
  priceMinor: z.number().int().min(0).optional(),
  billingCycle: z.enum(billingCycleValues).optional(),
  features: z.record(z.unknown()).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), {
  message: "at least one field must be provided",
});
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;

export const planIdParam = z.object({ planId: z.string().uuid() });

/**
 * Resolves module dependencies for a plan's enabledModules array.
 * Auto-expands dependencies so the plan is always consistent.
 *
 * Called at plan creation and update time to ensure the stored module set
 * is always valid and complete — no unmet dependencies at runtime.
 */
export function resolveAndValidateModules(userSelected: string[]): ResolutionResult {
  return resolveModules(userSelected);
}

/** M6 price store: one new price for a plan (by code) or an add-on module (by catalogue id). */
export const setPriceBody = z.object({
  subjectKind: z.enum(["plan", "addon"]),
  subjectKey: z.string().min(1).max(64),
  billingCycle: z.enum(billingCycleValues).default("annual"),
  /** Net price in paise (INR minor units), GST excluded. */
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** GST in basis points; 1800 = 18%. Shown separately on a quote. */
  gstRateBps: z.number().int().min(0).max(10_000).default(1800),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  note: z.string().max(500).optional(),
}).superRefine((b, ctx) => {
  if (b.subjectKind === "addon") {
    const m = CATALOGUE_BY_ID.get(b.subjectKey);
    if (!m || m.isCore) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["subjectKey"], message: `not a sellable catalogue module: ${b.subjectKey}` });
  }
});
export type SetPriceBody = z.infer<typeof setPriceBody>;
