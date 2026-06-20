import { z } from "zod";

export const submitApplicationBody = z.object({
  beneficiaryId:        z.string().uuid(),
  purpose:              z.string().min(10).max(2000),
  amountRequestedMinor: z.number().int().positive(),
  currency:             z.string().length(3).default("INR"),
});
export type SubmitApplicationBody = z.infer<typeof submitApplicationBody>;

export const scoreApplicationBody = z.object({
  reviewerRef:    z.string().min(1),
  technicalScore: z.number().min(0).max(100),
  financialScore: z.number().min(0).max(100),
  recommendation: z.string().optional(),
});
export type ScoreApplicationBody = z.infer<typeof scoreApplicationBody>;

export const approveApplicationBody = z.object({
  amountApprovedMinor: z.number().int().positive(),
});
export type ApproveApplicationBody = z.infer<typeof approveApplicationBody>;

export const rejectApplicationBody = z.object({
  reason: z.string().min(10).max(1000),
});
export type RejectApplicationBody = z.infer<typeof rejectApplicationBody>;

export const idParam = z.object({ id: z.string().uuid() });
