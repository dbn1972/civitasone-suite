import { z } from "zod";

export const assignBriefBody = z.object({
  caseId:       z.string().uuid(),
  hearingId:    z.string().uuid().optional(),
  counselName:  z.string().min(1).max(256),
  counselType:  z.enum(["advocate", "senior_advocate", "counsel", "law_officer"]).default("advocate"),
  briefSummary: z.string().min(1).max(8000),
  feeMinor:     z.number().int().nonnegative().optional(),
  currency:     z.string().length(3).optional(),
});
export type AssignBriefBody = z.infer<typeof assignBriefBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listBriefsQuery = z.object({
  caseId: z.string().uuid().optional(),
  status: z.enum(["assigned", "accepted", "completed", "withdrawn"]).optional(),
});
