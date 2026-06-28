import { z } from "zod";
import { SOURCE_REF_TYPES } from "@civitasone/eoffice-sdk";

export const APPROVAL_MODULES = [
  "finance", "hr", "procurement", "grant", "legal", "asset", "contract",
] as const;

export const approvalStep = z.object({
  role:  z.string().min(1),
  label: z.string().min(1),
});
export type ApprovalStep = z.infer<typeof approvalStep>;

export const createApprovalRuleBody = z
  .object({
    module:                 z.enum(APPROVAL_MODULES),
    sourceType:             z.enum(SOURCE_REF_TYPES),
    label:                  z.string().min(3).max(200),
    minAmountMinor:         z.number().int().nonnegative().default(0),
    maxAmountMinor:         z.number().int().positive().nullable().default(null),
    workflowDefinitionCode: z.string().min(1),
    startNodeKey:           z.string().min(1).default("review"),
    steps:                  z.array(approvalStep).min(1),
    priority:               z.number().int().min(0).max(10_000).default(100),
  })
  .refine(
    (r) => r.maxAmountMinor === null || r.maxAmountMinor > r.minAmountMinor,
    { message: "maxAmountMinor must be greater than minAmountMinor", path: ["maxAmountMinor"] },
  );
export type CreateApprovalRuleBody = z.infer<typeof createApprovalRuleBody>;

export const updateApprovalRuleBody = z
  .object({
    label:                  z.string().min(3).max(200).optional(),
    minAmountMinor:         z.number().int().nonnegative().optional(),
    maxAmountMinor:         z.number().int().positive().nullable().optional(),
    workflowDefinitionCode: z.string().min(1).optional(),
    startNodeKey:           z.string().min(1).optional(),
    steps:                  z.array(approvalStep).min(1).optional(),
    priority:               z.number().int().min(0).max(10_000).optional(),
    active:                 z.boolean().optional(),
  });
export type UpdateApprovalRuleBody = z.infer<typeof updateApprovalRuleBody>;

export const listRulesQuery = z.object({
  sourceType: z.enum(SOURCE_REF_TYPES).optional(),
  module:     z.enum(APPROVAL_MODULES).optional(),
});

export const resolveQuery = z.object({
  sourceType:  z.enum(SOURCE_REF_TYPES),
  amountMinor: z.coerce.number().int().nonnegative().default(0),
});
