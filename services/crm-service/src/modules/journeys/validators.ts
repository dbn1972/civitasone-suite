/**
 * journeys module — zod boundary schemas (G1 + G2).
 *
 * Nothing past these schemas is trusted. `stageCode` and `templateKey` are constrained to
 * lower snake_case because they are stable machine keys that dashboards group on: allowing
 * "Lead Captured" and "lead_captured" to coexist would reintroduce exactly the
 * non-comparable funnels this feature removes.
 */
import { z } from "zod";
import { GOVERNANCE, TEMPLATE_STATUSES } from "./schema.js";

/** Stable machine key: lower snake_case, must start with a letter. */
export const MACHINE_KEY = /^[a-z][a-z0-9_]*$/;

export const stageCodeSchema = z.string().min(2).max(64).regex(MACHINE_KEY, {
  message: "stageCode must be lower snake_case (e.g. lead_captured)",
});

export const templateKeySchema = z.string().min(2).max(64).regex(MACHINE_KEY, {
  message: "templateKey must be lower snake_case (e.g. sme_acquisition)",
});

export const idParam = z.object({ id: z.string().uuid() });

// ── Stage vocabulary ───────────────────────────────────────────────────────────

/**
 * `governance` is absent on purpose: a tenant cannot declare its own code canonical.
 * Canonical rows arrive only through the seed migration.
 */
export const createStageBody = z.object({
  stageCode: stageCodeSchema,
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  ordinal: z.number().int().min(0).max(100000).default(0),
  required: z.boolean().default(false),
});
export type CreateStageBody = z.infer<typeof createStageBody>;

export const updateStageBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  ordinal: z.number().int().min(0).max(100000).optional(),
  required: z.boolean().optional(),
  version: z.number().int().min(1),
}).refine(
  (b) => b.displayName !== undefined || b.description !== undefined
    || b.ordinal !== undefined || b.required !== undefined,
  { message: "at least one mutable field is required" },
);
export type UpdateStageBody = z.infer<typeof updateStageBody>;

export const stageListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  governance: z.enum(GOVERNANCE).optional(),
});

// ── Journey templates ──────────────────────────────────────────────────────────

export const journeyStepSchema = z.object({
  id: z.string().uuid(),
  stageCode: stageCodeSchema,
  ordinal: z.number().int().min(0).max(100000),
  slaHours: z.number().int().min(0).max(87600).optional(),
  communicationTemplateRef: z.string().min(1).max(120).optional(),
  mandatoryFields: z.array(z.string().min(1).max(64)).max(64).optional(),
  assignmentRule: z.string().min(1).max(120).optional(),
  required: z.boolean().optional(),
});
export type JourneyStepInput = z.infer<typeof journeyStepSchema>;

const scope = {
  product: z.string().min(1).max(120).nullable().optional(),
  region: z.string().min(1).max(120).nullable().optional(),
  businessUnit: z.string().min(1).max(120).nullable().optional(),
};

export const createTemplateBody = z.object({
  templateKey: templateKeySchema,
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  parentTemplateId: z.string().uuid().optional(),
  steps: z.array(journeyStepSchema).min(1).max(50),
  ...scope,
});
export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const updateTemplateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  steps: z.array(journeyStepSchema).min(1).max(50).optional(),
  ...scope,
  version: z.number().int().min(1),
}).refine(
  (b) => b.name !== undefined || b.description !== undefined || b.steps !== undefined
    || b.product !== undefined || b.region !== undefined || b.businessUnit !== undefined,
  { message: "at least one mutable field is required" },
);
export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

/**
 * Publishing may carry a replacement definition. When it does, the consumer inserts a NEW
 * version row rather than editing the current one — see the module README.
 */
export const publishTemplateBody = z.object({
  steps: z.array(journeyStepSchema).min(1).max(50).optional(),
  version: z.number().int().min(1).optional(),
});
export type PublishTemplateBody = z.infer<typeof publishTemplateBody>;

export const deprecateTemplateBody = z.object({
  reason: z.string().max(2000).optional(),
  version: z.number().int().min(1).optional(),
});
export type DeprecateTemplateBody = z.infer<typeof deprecateTemplateBody>;

export const templateListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  templateKey: templateKeySchema.optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  governance: z.enum(GOVERNANCE).optional(),
  product: z.string().min(1).max(120).optional(),
  region: z.string().min(1).max(120).optional(),
  businessUnit: z.string().min(1).max(120).optional(),
});
