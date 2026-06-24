import { z } from "zod";

export const createObservationBody = z.object({
  obsNo:               z.string().min(1).max(64),
  planId:              z.string().uuid().optional(),
  auditeeRef:          z.string().min(1).max(128),
  finding:             z.string().min(1).max(4000),
  category:            z.enum(["performance", "compliance", "financial"]).default("compliance"),
  riskLevel:           z.enum(["low", "medium", "high"]).default("medium"),
  // P0-3: money in PAISE carried as a decimal string to avoid float/Number truncation
  // of amounts above 2^53. Validated as a non-negative integer string; BigInt()-parsed downstream.
  amountInvolvedMinor: z.string().regex(/^\d+$/, "must be a non-negative integer string").default("0"),
});
export type CreateObservationBody = z.infer<typeof createObservationBody>;

export const draftParaBody = z.object({
  paraNo:   z.string().min(1).max(64),
  deptRef:  z.string().min(1).max(128),
  body:     z.string().min(1).max(8000),
  sourceRef: z.string().max(256).optional(),
});
export type DraftParaBody = z.infer<typeof draftParaBody>;

/** AU-01: Auditee submits a compliance reply to an observation */
export const complianceReplyBody = z.object({
  replyText:       z.string().min(1).max(4000),
  respondedByRef:  z.string().min(1).max(128),
  attachmentRef:   z.string().max(512).optional(),
});
export type ComplianceReplyBody = z.infer<typeof complianceReplyBody>;

/** AU-01: Auditor accepts or rejects the compliance reply */
export const reviewReplyBody = z.object({
  decision:    z.enum(["accepted", "rejected"]),
  remarks:     z.string().max(2000).optional(),
});
export type ReviewReplyBody = z.infer<typeof reviewReplyBody>;

export const idParam = z.object({ id: z.string().uuid() });
