import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const createCourtCaseBody = z.object({
  caseNo:     z.string().min(1),
  title:      z.string().min(1),
  court:      z.string().min(1),
  subject:    z.string().optional(),
  petitioner: z.string().optional(),
});
export type CreateCourtCaseBody = z.infer<typeof createCourtCaseBody>;

export const setNextDateBody = z.object({
  hearingDate: z.string(),
  purpose:     z.string().optional(),
  outcome:     z.string().optional(),
  nextDate:    z.string().optional(),
});
export type SetNextDateBody = z.infer<typeof setNextDateBody>;

export const createRtiBody = z.object({
  rtiNo:     z.string().min(1),
  applicant: z.string().min(1),
  subject:   z.string().min(1),
  cpioRef:   z.string().uuid(),
});
export type CreateRtiBody = z.infer<typeof createRtiBody>;

export const respondRtiBody = z.object({
  responseUrl: z.string().url(),
});
export type RespondRtiBody = z.infer<typeof respondRtiBody>;
