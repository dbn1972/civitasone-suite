import { z } from "zod";

export const createApprovalLevelBody = z.object({
  minValuePaise: z.string().regex(/^\d+$/, "must be a non-negative integer string"),
  requiredRole: z.string().min(1).max(100),
  label: z.string().max(200).default(""),
});

export type CreateApprovalLevelBody = z.infer<typeof createApprovalLevelBody>;

export const updateApprovalLevelBody = z.object({
  minValuePaise: z.string().regex(/^\d+$/, "must be a non-negative integer string").optional(),
  requiredRole: z.string().min(1).max(100).optional(),
  label: z.string().max(200).optional(),
  version: z.number().int().min(1),
});

export type UpdateApprovalLevelBody = z.infer<typeof updateApprovalLevelBody>;

export const approvalLevelIdParam = z.object({
  id: z.string().uuid(),
});

export const approvalLevelListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const resolveApprovalQuery = z.object({
  contractValue: z.string().regex(/^\d+$/, "must be a non-negative integer string"),
});
