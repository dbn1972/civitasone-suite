/**
 * Lead assignment rules engine — pure domain logic.
 *
 * Evaluates assignment rules in priority order (ascending ordinal) to determine
 * which owner a new lead should be routed to. Supports territory match,
 * round-robin cycling, and score threshold criteria.
 *
 * If no enabled rule matches, the fallback owner is assigned.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  territory?: string | null;
  score?: number | null;
}

export type AssignmentRuleType = "territory" | "round_robin" | "score_threshold";

export interface TerritoryCriteria {
  territory: string;
  ownerId: string;
}

export interface RoundRobinCriteria {
  roster: string[]; // owner IDs to cycle through
  currentIndex: number; // last-assigned index in the roster
}

export interface ScoreThresholdCriteria {
  threshold: number; // lead.score must be >= this
  ownerId: string;
}

export type RuleCriteria = TerritoryCriteria | RoundRobinCriteria | ScoreThresholdCriteria;

export interface AssignmentRule {
  id: string;
  type: AssignmentRuleType;
  criteria: RuleCriteria;
  ordinal: number;
  enabled: boolean;
}

export interface AssignmentResult {
  assignedTo: string;
  matchedRuleId: string | null;
  reason: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Assigns a lead to an owner based on the first matching rule.
 * Rules are evaluated in ascending ordinal order. Disabled rules are skipped.
 * If no rule matches, the fallbackOwnerId is used.
 *
 * For round-robin rules, the returned result includes the next index so the
 * caller can persist the updated `currentIndex` after assignment.
 */
export function assignLead(
  lead: Lead,
  rules: AssignmentRule[],
  fallbackOwnerId: string,
): AssignmentResult {
  // Sort by ascending ordinal for priority evaluation
  const sorted = [...rules].sort((a, b) => a.ordinal - b.ordinal);

  for (const rule of sorted) {
    if (!rule.enabled) continue;

    const result = evaluateRule(lead, rule);
    if (result !== null) {
      return result;
    }
  }

  // No rule matched — use fallback
  return {
    assignedTo: fallbackOwnerId,
    matchedRuleId: null,
    reason: "no_rule_matched",
  };
}

/**
 * Evaluates a single rule against a lead.
 * Returns an AssignmentResult if the rule matches, or null if it does not.
 */
function evaluateRule(lead: Lead, rule: AssignmentRule): AssignmentResult | null {
  switch (rule.type) {
    case "territory":
      return evaluateTerritory(lead, rule);
    case "round_robin":
      return evaluateRoundRobin(lead, rule);
    case "score_threshold":
      return evaluateScoreThreshold(lead, rule);
    default:
      return null;
  }
}

function evaluateTerritory(lead: Lead, rule: AssignmentRule): AssignmentResult | null {
  const criteria = rule.criteria as TerritoryCriteria;
  if (!lead.territory || lead.territory !== criteria.territory) {
    return null;
  }
  return {
    assignedTo: criteria.ownerId,
    matchedRuleId: rule.id,
    reason: `territory_match:${criteria.territory}`,
  };
}

function evaluateRoundRobin(_lead: Lead, rule: AssignmentRule): AssignmentResult | null {
  const criteria = rule.criteria as RoundRobinCriteria;
  if (!criteria.roster || criteria.roster.length === 0) {
    return null;
  }
  // Advance to next index (wrapping around)
  const nextIndex = (criteria.currentIndex + 1) % criteria.roster.length;
  const assignedTo = criteria.roster[nextIndex];
  if (!assignedTo) {
    return null;
  }
  return {
    assignedTo,
    matchedRuleId: rule.id,
    reason: `round_robin:index_${nextIndex}`,
  };
}

function evaluateScoreThreshold(lead: Lead, rule: AssignmentRule): AssignmentResult | null {
  const criteria = rule.criteria as ScoreThresholdCriteria;
  if (lead.score == null || lead.score < criteria.threshold) {
    return null;
  }
  return {
    assignedTo: criteria.ownerId,
    matchedRuleId: rule.id,
    reason: `score_threshold:${criteria.threshold}`,
  };
}
