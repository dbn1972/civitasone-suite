import { z } from "zod";

export const seekOpinionBody = z.object({
  opinionNo: z.string().min(1).max(64),
  subject:   z.string().min(1).max(256),
  question:  z.string().min(1).max(4000),
  caseId:    z.string().uuid().optional(),
  soughtBy:  z.string().max(256).optional(),
});
export type SeekOpinionBody = z.infer<typeof seekOpinionBody>;

export const draftOpinionBody = z.object({
  counselName: z.string().min(1).max(256),
  opinionText: z.string().min(1).max(20000),
});
export type DraftOpinionBody = z.infer<typeof draftOpinionBody>;

export const issueOpinionBody = z.object({
  opinionText: z.string().min(1).max(20000).optional(),
});
export type IssueOpinionBody = z.infer<typeof issueOpinionBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listOpinionsQuery = z.object({
  status: z.enum(["sought", "drafted", "issued"]).optional(),
  caseId: z.string().uuid().optional(),
});
