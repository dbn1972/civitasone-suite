import { z } from "zod";
import { PERFORMANCE_EVENT_TYPES } from "./scorecard-domain.js";

export const recomputeScorecardBody = z.object({
  // Optional manual performance event to append before recomputing.
  eventType: z.enum(PERFORMANCE_EVENT_TYPES).optional(),
  poRef:     z.string().max(256).optional(),
  sourceRef: z.string().max(256).optional(),
});
export type RecomputeScorecardBody = z.infer<typeof recomputeScorecardBody>;

export const issueShowCauseBody = z.object({
  reason: z.string().min(3).max(2000),
});
export type IssueShowCauseBody = z.infer<typeof issueShowCauseBody>;

export const respondShowCauseBody = z.object({
  response: z.string().min(1).max(2000),
});
export type RespondShowCauseBody = z.infer<typeof respondShowCauseBody>;

export const appealShowCauseBody = z.object({
  appealText: z.string().min(1).max(2000),
});
export type AppealShowCauseBody = z.infer<typeof appealShowCauseBody>;

export const decideShowCauseBody = z.object({
  decision: z.string().min(1).max(2000),
  uphold:   z.boolean(),
});
export type DecideShowCauseBody = z.infer<typeof decideShowCauseBody>;

export const vendorIdParam = z.object({ vendorId: z.string().uuid() });
export const showCauseIdParam = z.object({ id: z.string().uuid() });
