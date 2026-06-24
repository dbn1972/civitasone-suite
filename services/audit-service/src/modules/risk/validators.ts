import { z } from "zod";

export const riskCategory = z.enum(["financial", "operational", "compliance", "reputational", "strategic", "it"]);
export const likelihoodEnum = z.enum(["rare", "unlikely", "possible", "likely", "almost_certain"]);
export const impactEnum = z.enum(["negligible", "minor", "moderate", "major", "catastrophic"]);

// P1-7: NOTE — riskScore is intentionally NOT accepted from the client; it is computed
// server-side from likelihood x impact. Accepting it would re-introduce the trusted-input bug.
export const createRiskBody = z.object({
  riskCode:   z.string().min(1).max(64),
  title:      z.string().min(1).max(256),
  category:   riskCategory.default("operational"),
  likelihood: likelihoodEnum,
  impact:     impactEnum,
  owner:      z.string().max(128).optional(),
  reviewDate: z.string().optional(),
});
export type CreateRiskBody = z.infer<typeof createRiskBody>;

export const updateRiskBody = z.object({
  likelihood:       likelihoodEnum.optional(),
  impact:           impactEnum.optional(),
  mitigationStatus: z.enum(["not_started", "in_progress", "implemented", "accepted"]).optional(),
  status:           z.enum(["open", "mitigated", "closed", "escalated"]).optional(),
  owner:            z.string().max(128).optional(),
  reviewDate:       z.string().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateRiskBody = z.infer<typeof updateRiskBody>;

// P1-7: link selected risks to an audit plan (risk-driven planning / audit universe).
export const linkRisksBody = z.object({
  riskIds: z.array(z.string().uuid()).min(1).max(100),
});
export type LinkRisksBody = z.infer<typeof linkRisksBody>;

export const idParam = z.object({ id: z.string().uuid() });
