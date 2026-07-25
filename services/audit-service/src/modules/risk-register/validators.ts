import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });
export const acceptanceIdParam = z.object({ id: z.string().uuid() });

export const createControlBody = z.object({
  riskId:      z.string().uuid(),
  controlCode: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  controlType: z.enum(["preventive", "detective", "corrective"]).default("preventive"),
  owner:       z.string().max(128).optional(),
});
export type CreateControlBody = z.infer<typeof createControlBody>;

export const testControlBody = z.object({
  result:   z.enum(["pass", "fail", "partial"]),
  testedBy: z.string().max(128).optional(),
  notes:    z.string().max(2000).optional(),
});
export type TestControlBody = z.infer<typeof testControlBody>;

export const createIncidentBody = z.object({
  riskId:      z.string().uuid().optional(),
  title:       z.string().min(1).max(256),
  description: z.string().min(1).max(4000),
  severity:    z.enum(["minor", "moderate", "major", "critical"]).default("minor"),
  reportedBy:  z.string().max(128).optional(),
});
export type CreateIncidentBody = z.infer<typeof createIncidentBody>;

export const createMitigationBody = z.object({
  riskId:  z.string().uuid(),
  action:  z.string().min(1).max(2000),
  owner:   z.string().max(128).optional(),
  dueDate: z.string().optional(),
});
export type CreateMitigationBody = z.infer<typeof createMitigationBody>;

export const proposeAcceptanceBody = z.object({
  riskId:        z.string().uuid(),
  rationale:     z.string().min(1).max(4000),
  // Non-authoritative client hint only: the residual score is ALWAYS recomputed
  // server-side from the risk's likelihood/impact and its controls' tested
  // effectiveness (see consumer). Accepted for backward-compat, never trusted.
  residualScore: z.number().int().min(1).max(25).optional(),
  validUntil:    z.string().optional(),
});
export type ProposeAcceptanceBody = z.infer<typeof proposeAcceptanceBody>;

export const decideAcceptanceBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks:  z.string().max(2000).optional(),
});
export type DecideAcceptanceBody = z.infer<typeof decideAcceptanceBody>;

export const reviewRiskBody = z.object({
  riskId:     z.string().uuid(),
  outcome:    z.enum(["unchanged", "increased", "decreased", "closed"]).default("unchanged"),
  cadence:    z.enum(["monthly", "quarterly", "half_yearly", "annual"]).default("quarterly"),
  reviewedBy: z.string().max(128).optional(),
  notes:      z.string().max(2000).optional(),
});
export type ReviewRiskBody = z.infer<typeof reviewRiskBody>;
