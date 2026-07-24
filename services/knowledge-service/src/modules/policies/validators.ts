import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (yyyy-mm-dd)");

export const createPolicyBody = z.object({
  title: z.string().min(1).max(200),
  docType: z.enum(["sop", "policy", "circular"]).default("sop"),
  referenceNo: z.string().min(1).max(64).optional(),
  body: z.string().max(200_000).default(""),
  reviewDueDate: isoDate.optional(),
});
export type CreatePolicyBody = z.infer<typeof createPolicyBody>;

export const submitPolicyBody = z.object({
  reviewerId: z.string().uuid().optional(),
});
export type SubmitPolicyBody = z.infer<typeof submitPolicyBody>;

export const publishPolicyBody = z.object({
  effectiveDate: isoDate.optional(),
  reviewDueDate: isoDate.optional(),
  reviewMonths: z.number().int().min(1).max(120).optional(),
  supersedesId: z.string().uuid().optional(),
  notifyUserIds: z.array(z.string().uuid()).max(1000).default([]),
});
export type PublishPolicyBody = z.infer<typeof publishPolicyBody>;

export const acknowledgePolicyBody = z.object({
  employeeId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});
export type AcknowledgePolicyBody = z.infer<typeof acknowledgePolicyBody>;

export const ackReportBody = z.object({
  expectedEmployeeIds: z.array(z.string().uuid()).max(10_000).default([]),
});
export type AckReportBody = z.infer<typeof ackReportBody>;

export const listPolicyQuery = z.object({
  status: z.enum(["draft", "under_review", "approved", "published", "superseded", "withdrawn"]).optional(),
  docType: z.enum(["sop", "policy", "circular"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPolicyQuery = z.infer<typeof listPolicyQuery>;
