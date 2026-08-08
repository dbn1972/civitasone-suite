import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { ENGINE_BLOCKS, ENGINE_KEYS } from "./domain.js";

const exemptionCategorySchema = z.object({
  code: safeText({ max: 32, min: 0 }),
  label: safeText({ max: 80, min: 0 }),
  percentBps: z.number().int().min(0).max(10_000),
});

export const engineBindingConfigSchema = z.object({
  exemptionCategories: z.array(exemptionCategorySchema).max(50).default([]),
  penaltyPercentBps: z.number().int().min(0).max(10_000).default(0),
  rebatePercentBps: z.number().int().min(0).max(10_000).default(0),
  rebateWindowDays: z.number().int().min(0).max(3650).default(0),
  penaltyGraceDays: z.number().int().min(0).max(3650).default(0),
  hoaCode: safeText({ max: 32, min: 0 }).default(""),
  extras: z.record(z.string(), safeText({ max: 256, min: 0 })).default({}),
});

export const engineBindingSchema = z.object({
  id: z.string().uuid().optional(),
  block: z.enum(ENGINE_BLOCKS),
  engineKey: z.enum(ENGINE_KEYS),
  config: engineBindingConfigSchema.default({
    exemptionCategories: [],
    penaltyPercentBps: 0,
    rebatePercentBps: 0,
    rebateWindowDays: 0,
    penaltyGraceDays: 0,
    hoaCode: "",
    extras: {},
  }),
  requiredForPublish: z.boolean().default(true),
});

export const engineBindingsArraySchema = z.array(engineBindingSchema).max(20);

export const enginePreviewBody = z.object({
  binding: engineBindingSchema,
  basePrincipalMinor: z.number().int().min(0).max(1_000_000_000_000),
  selectedExemptions: z.array(safeText({ max: 32 })).max(20).default([]),
  applyRebate: z.boolean().default(false),
  applyPenalty: z.boolean().default(false),
});
export type EnginePreviewBody = z.infer<typeof enginePreviewBody>;

export const engineBlockQuery = z.object({
  block: z.enum(ENGINE_BLOCKS).optional(),
});
