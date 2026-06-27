import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const stepDefBody = z.object({
  stepKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "stepKey must be lowercase alphanumeric with hyphens/underscores"),
  title: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  isRequired: z.boolean().optional().default(true),
  dependsOn: z.array(z.string().min(1).max(64)).optional().default([]),
  handlerType: z.string().min(1).max(64),
  config: z.record(z.unknown()).optional().default({}),
  sortOrder: z.number().int().min(0).optional().default(0),
});
export type StepDefBody = z.infer<typeof stepDefBody>;

export const createWizardBody = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  steps: z.array(stepDefBody).min(1).max(50),
});
export type CreateWizardBody = z.infer<typeof createWizardBody>;

export const completeStepBody = z.object({
  output: z.record(z.unknown()).optional().default({}),
});
export type CompleteStepBody = z.infer<typeof completeStepBody>;

export const skipStepBody = z.object({
  reason: z.string().max(500).optional(),
});
export type SkipStepBody = z.infer<typeof skipStepBody>;

export const wizardIdParam = z.object({
  wizardId: z.string().uuid(),
});

export const stepKeyParam = z.object({
  wizardId: z.string().uuid(),
  stepKey: z.string().min(1).max(64),
});

export const wizardProgressView = z.object({
  wizardId: z.string().uuid(),
  name: z.string(),
  total: z.number().int(),
  completed: z.number().int(),
  percentage: z.number().int(),
  isComplete: z.boolean(),
  steps: z.array(z.object({
    stepKey: z.string(),
    title: z.string(),
    status: z.string(),
    isRequired: z.boolean(),
    dependsOn: z.array(z.string()),
    sortOrder: z.number().int(),
  })),
});
export type WizardProgressView = z.infer<typeof wizardProgressView>;

export const wizardListItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
});

export const wizardsListSchema = paginatedSchema(wizardListItemSchema);
