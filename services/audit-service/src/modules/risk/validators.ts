import { z } from "zod";

export const riskCategory = z.enum(["financial", "operational", "compliance", "reputational", "strategic", "it"]);
export const likelihoodEnum = z.enum(["rare", "unlikely", "possible", "likely", "almost_certain"]);
export const impactEnum = z.enum(["negligible", "minor", "moderate", "major", "catastrophic"]);
/**
 * FQ12 (#55): PATCH status values = DB CHECK audit_risks_status_check (migration 0016:
 * open/mitigating/closed/accepted) INTERSECTED with the read contract
 * RiskSummarySchema.status (@civitasone/schemas/web: open/mitigated/closed/escalated).
 * A value outside the CHECK used to get a 202 and then be dropped by the consumer;
 * a value outside the contract would persist but 500 every risk list read. Widening
 * this needs RiskSummarySchema aligned to the DB first.
 */
export const riskStatusEnum = z.enum(["open", "closed"]);
/** Same rule for mitigation_status: CHECK (not_started/in_progress/completed) ∩ contract (not_started/in_progress/implemented/accepted). */
export const riskMitigationStatusEnum = z.enum(["not_started", "in_progress"]);

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
  // FQ12 (#55): only values the DB CHECK accepts (see riskStatusEnum) -- 400, not a silent drop.
  mitigationStatus: riskMitigationStatusEnum.optional(),
  status:           riskStatusEnum.optional(),
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
