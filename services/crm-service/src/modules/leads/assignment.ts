/**
 * Lead assignment rules engine — pure domain logic (AS-001, AS-003).
 *
 * Evaluates assignment rules in priority order (ascending ordinal) to determine
 * which owner a new lead should be routed to. Supports:
 *  - territory  (geography match → owner)
 *  - product / segment / language (attribute match → owner)
 *  - score_threshold (lead.score >= threshold → owner)
 *  - round_robin (cycle a roster, skipping ineligible agents)
 *  - capacity   (least-loaded eligible agent in a roster)
 *
 * If no enabled rule matches, the fallback owner is assigned.
 *
 * AS-003 availability is folded in as a pure input: the caller passes the current
 * `agents` availability snapshot and the engine excludes any agent that is
 * unavailable, on leave, or at/over capacity. With no snapshot the engine behaves
 * exactly as before (no exclusion), so the LM-era unit tests are unaffected.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  territory?: string | null;
  score?: number | null;
  product?: string | null;
  segment?: string | null;
  language?: string | null;
}

export type AssignmentRuleType =
  | "territory"
  | "round_robin"
  | "score_threshold"
  | "product"
  | "segment"
  | "language"
  | "capacity";

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

/** product / segment / language rules all match one lead attribute to a value. */
export interface AttributeCriteria {
  value: string;
  ownerId: string;
}

/** capacity rule picks the least-loaded eligible agent from a roster. */
export interface CapacityCriteria {
  roster: string[];
}

export type RuleCriteria =
  | TerritoryCriteria
  | RoundRobinCriteria
  | ScoreThresholdCriteria
  | AttributeCriteria
  | CapacityCriteria;

export interface AssignmentRule {
  id: string;
  type: AssignmentRuleType;
  criteria: RuleCriteria;
  ordinal: number;
  enabled: boolean;
}

/**
 * A live availability snapshot for one agent (AS-003). `currentLoad`/`maxLeads`
 * come from crm.agent_workload; `currentLoad` may be recomputed from owner_id
 * counts by the caller before it is passed in.
 */
export interface AgentAvailability {
  ownerId: string;
  available: boolean;
  onLeave: boolean;
  currentLoad: number;
  maxLeads: number;
}

export interface AssignOptions {
  /** Availability snapshot keyed by ownerId. Absent ⇒ no exclusion applied. */
  agents?: AgentAvailability[];
}

export interface AssignmentResult {
  assignedTo: string;
  matchedRuleId: string | null;
  reason: string;
  /**
   * For round_robin rules, the roster index that was assigned, so the caller can
   * persist it as the rule's next cursor. Undefined for every other rule type.
   */
  roundRobinIndex?: number;
}

// ─── Eligibility (AS-003) ────────────────────────────────────────────────────

type EligibilityMap = Map<string, AgentAvailability>;

function buildEligibility(opts?: AssignOptions): EligibilityMap | null {
  if (!opts?.agents || opts.agents.length === 0) return null;
  const m: EligibilityMap = new Map();
  for (const a of opts.agents) m.set(a.ownerId, a);
  return m;
}

/**
 * An owner is eligible unless the snapshot marks them unavailable / on leave /
 * at capacity. An owner absent from the snapshot is treated as eligible: workload
 * rows are opt-in, and excluding everyone without a row would starve assignment.
 */
export function isEligible(ownerId: string, elig: EligibilityMap | null): boolean {
  if (!elig) return true;
  const a = elig.get(ownerId);
  if (!a) return true;
  if (!a.available) return false;
  if (a.onLeave) return false;
  if (a.currentLoad >= a.maxLeads) return false;
  return true;
}

/** Remaining capacity, used to rank capacity-rule candidates. */
function remaining(ownerId: string, elig: EligibilityMap | null): number {
  const a = elig?.get(ownerId);
  if (!a) return Number.POSITIVE_INFINITY; // unknown load ⇒ treat as most free
  return a.maxLeads - a.currentLoad;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Assigns a lead to an owner based on the first matching rule.
 * Rules are evaluated in ascending ordinal order. Disabled rules are skipped.
 * If no rule matches (or every matching rule targets an ineligible agent), the
 * fallbackOwnerId is used.
 */
export function assignLead(
  lead: Lead,
  rules: AssignmentRule[],
  fallbackOwnerId: string,
  opts?: AssignOptions,
): AssignmentResult {
  const elig = buildEligibility(opts);
  const sorted = [...rules].sort((a, b) => a.ordinal - b.ordinal);

  for (const rule of sorted) {
    if (!rule.enabled) continue;
    const result = evaluateRule(lead, rule, elig);
    if (result !== null) return result;
  }

  return {
    assignedTo: fallbackOwnerId,
    matchedRuleId: null,
    reason: "no_rule_matched",
  };
}

function evaluateRule(
  lead: Lead,
  rule: AssignmentRule,
  elig: EligibilityMap | null,
): AssignmentResult | null {
  switch (rule.type) {
    case "territory":
      return evaluateAttribute(lead.territory, rule, "territory", elig);
    case "product":
      return evaluateAttribute(lead.product, rule, "product", elig);
    case "segment":
      return evaluateAttribute(lead.segment, rule, "segment", elig);
    case "language":
      return evaluateAttribute(lead.language, rule, "language", elig);
    case "round_robin":
      return evaluateRoundRobin(rule, elig);
    case "score_threshold":
      return evaluateScoreThreshold(lead, rule, elig);
    case "capacity":
      return evaluateCapacity(rule, elig);
    default:
      return null;
  }
}

/**
 * territory/product/segment/language share one shape: match a single lead
 * attribute against a configured value, routing to a fixed owner. When the target
 * owner is ineligible the rule is skipped (returns null) so evaluation falls
 * through to the next rule / fallback rather than routing to an unavailable agent.
 */
function evaluateAttribute(
  leadValue: string | null | undefined,
  rule: AssignmentRule,
  label: string,
  elig: EligibilityMap | null,
): AssignmentResult | null {
  // territory stores its value under `territory`; the others under `value`.
  const c = rule.criteria as TerritoryCriteria & AttributeCriteria;
  const expected = label === "territory" ? c.territory : c.value;
  if (!leadValue || leadValue !== expected) return null;
  if (!isEligible(c.ownerId, elig)) return null;
  return {
    assignedTo: c.ownerId,
    matchedRuleId: rule.id,
    reason: `${label}_match:${expected}`,
  };
}

function evaluateRoundRobin(
  rule: AssignmentRule,
  elig: EligibilityMap | null,
): AssignmentResult | null {
  const c = rule.criteria as RoundRobinCriteria;
  if (!c.roster || c.roster.length === 0) return null;

  // Walk the roster starting one past the last cursor, wrapping, and take the
  // first eligible owner. Without a snapshot the first candidate is always
  // (currentIndex + 1) % len, preserving the original round-robin behaviour.
  const len = c.roster.length;
  for (let step = 1; step <= len; step++) {
    const idx = (c.currentIndex + step) % len;
    const candidate = c.roster[idx];
    if (candidate && isEligible(candidate, elig)) {
      return {
        assignedTo: candidate,
        matchedRuleId: rule.id,
        reason: `round_robin:index_${idx}`,
        roundRobinIndex: idx,
      };
    }
  }
  return null; // every roster member ineligible
}

function evaluateScoreThreshold(
  lead: Lead,
  rule: AssignmentRule,
  elig: EligibilityMap | null,
): AssignmentResult | null {
  const c = rule.criteria as ScoreThresholdCriteria;
  if (lead.score == null || lead.score < c.threshold) return null;
  if (!isEligible(c.ownerId, elig)) return null;
  return {
    assignedTo: c.ownerId,
    matchedRuleId: rule.id,
    reason: `score_threshold:${c.threshold}`,
  };
}

function evaluateCapacity(
  rule: AssignmentRule,
  elig: EligibilityMap | null,
): AssignmentResult | null {
  const c = rule.criteria as CapacityCriteria;
  if (!c.roster || c.roster.length === 0) return null;

  let best: string | null = null;
  let bestRemaining = -Infinity;
  for (const ownerId of c.roster) {
    if (!isEligible(ownerId, elig)) continue;
    const rem = remaining(ownerId, elig);
    if (rem > bestRemaining) {
      bestRemaining = rem;
      best = ownerId;
    }
  }
  if (!best) return null;
  return {
    assignedTo: best,
    matchedRuleId: rule.id,
    reason: "capacity_least_loaded",
  };
}
