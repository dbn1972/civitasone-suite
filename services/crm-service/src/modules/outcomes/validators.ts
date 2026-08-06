/**
 * outcomes module — zod boundary schemas (G18).
 *
 * Nothing past these schemas is trusted. Two choices worth stating:
 *
 *  - `amountMinor` is a STRING, not a number. A JSON number loses paise above 2^53, and
 *    accepting one here would put a rounded value in a bigint column with no trace.
 *  - `governance` is absent from every request body: a tenant cannot declare its own code
 *    canonical. Canonical rows arrive only through a seed migration.
 */
import { z } from "zod";
import { GOVERNANCE, OUTCOME_TYPES, SUBJECT_TYPES } from "./schema.js";

/** Stable machine key: lower snake_case, must start with a letter. */
export const MACHINE_KEY = /^[a-z][a-z0-9_]*$/;

export const reasonCodeSchema = z.string().min(2).max(64).regex(MACHINE_KEY, {
  message: "code must be lower snake_case (e.g. moved_to_other_provider)",
});

export const categorySchema = z.string().min(2).max(48).regex(MACHINE_KEY, {
  message: "category must be lower snake_case (e.g. interaction)",
});

/** Decimal minor units. Bounded so an absurd literal is refused before BigInt sees it. */
export const amountMinorSchema = z.string().regex(/^\d{1,25}$/, {
  message: "amountMinor must be a decimal string of non-negative minor units",
});

export const idParam = z.object({ id: z.string().uuid() });

// ── Reason-code catalogue ──────────────────────────────────────────────────────

export const createReasonCodeBody = z.object({
  code: reasonCodeSchema,
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: categorySchema.default("interaction"),
  /** Empty (the default) means the code applies to every outcome type. */
  appliesTo: z.array(z.enum(OUTCOME_TYPES)).max(OUTCOME_TYPES.length).default([]),
  ordinal: z.number().int().min(0).max(100000).default(0),
  active: z.boolean().default(true),
});
export type CreateReasonCodeBody = z.infer<typeof createReasonCodeBody>;

export const updateReasonCodeBody = z.object({
  label: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  appliesTo: z.array(z.enum(OUTCOME_TYPES)).max(OUTCOME_TYPES.length).optional(),
  ordinal: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
  version: z.number().int().min(1),
}).refine(
  (b) => b.label !== undefined || b.description !== undefined || b.appliesTo !== undefined
    || b.ordinal !== undefined || b.active !== undefined,
  { message: "at least one mutable field is required" },
);
export type UpdateReasonCodeBody = z.infer<typeof updateReasonCodeBody>;

export const reasonCodeListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: categorySchema.optional(),
  governance: z.enum(GOVERNANCE).optional(),
  /** Narrows to codes usable for one outcome type (including the "applies to all" ones). */
  outcomeType: z.enum(OUTCOME_TYPES).optional(),
  active: z.enum(["true", "false"]).optional(),
});

// ── Interaction outcomes ───────────────────────────────────────────────────────

export const recordOutcomeBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  outcomeRef: z.string().min(1).max(128),
  outcomeType: z.enum(OUTCOME_TYPES),
  reasonCodeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  amountMinor: amountMinorSchema.optional(),
  /** ISO 4217. Upper-cased so 'inr' and 'INR' cannot both appear in one report. */
  currency: z.string().length(3).regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()).optional(),
  followUpNextActionId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
});
export type RecordOutcomeBody = z.infer<typeof recordOutcomeBody>;

export const outcomeListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  outcomeType: z.enum(OUTCOME_TYPES).optional(),
  reasonCodeId: z.string().uuid().optional(),
});
