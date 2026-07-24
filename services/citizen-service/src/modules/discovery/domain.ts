/**
 * SVC-090 — proactive benefit-discovery matching (pure, unit-tested).
 *
 * Reuses the SVC-083 evaluator so "would this citizen likely qualify?" uses the
 * exact same rule semantics as a real application eligibility check. A service
 * is a "likely-eligible" match when its rule set yields `eligible` (a strong
 * match) or `refer_manual` (a soft match worth surfacing for assisted review).
 * `not_eligible` is never surfaced.
 */
import { evaluateEligibility, type EligibilityRule, type EligibilityOutcome, type RuleReason } from "../eligibility/domain.js";

export interface CandidateRuleSet {
  serviceId: string;
  ruleSetId: string;
  rules: EligibilityRule[];
}

export interface DiscoveryMatch {
  serviceId: string;
  ruleSetId: string;
  outcome: EligibilityOutcome;
  strength: "strong" | "soft";
  reasons: RuleReason[];
}

export function matchServices(candidates: CandidateRuleSet[], subject: Record<string, unknown>): DiscoveryMatch[] {
  const matches: DiscoveryMatch[] = [];
  for (const c of candidates) {
    const { outcome, reasons } = evaluateEligibility(c.rules, subject);
    if (outcome === "not_eligible") continue;
    matches.push({
      serviceId: c.serviceId,
      ruleSetId: c.ruleSetId,
      outcome,
      strength: outcome === "eligible" ? "strong" : "soft",
      reasons,
    });
  }
  return matches;
}

/** A consent grant is active when granted and not revoked. */
export function isConsentActive(consent: { granted: boolean; revokedAt: Date | string | null } | null | undefined): boolean {
  return Boolean(consent && consent.granted && !consent.revokedAt);
}
