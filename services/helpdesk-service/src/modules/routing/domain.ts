/**
 * Routing Domain — pure functions for ticket routing.
 *
 * - selectAgent: picks the best agent based on the rule strategy
 * - validateRulePrecedence: checks for ordering issues
 * - detectConflicts: finds overlapping rules with same criteria
 */

import type { RoutingRuleRow } from "./schema.js";
import type { AgentCapacityRow } from "./capacity-schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RoutingStrategy = "round_robin" | "weighted" | "skill_based" | "least_busy";

export const VALID_STRATEGIES: readonly RoutingStrategy[] = [
  "round_robin",
  "weighted",
  "skill_based",
  "least_busy",
] as const;

export interface RoutingConflict {
  ruleA: { id: string; name: string; ordinal: number };
  ruleB: { id: string; name: string; ordinal: number };
  reason: string;
}

export interface RoutingEvalResult {
  selectedAgentId: string | null;
  ruleName: string;
  strategy: RoutingStrategy;
  reason: string;
}

// ─── selectAgent ──────────────────────────────────────────────────────────────

/**
 * Select the best agent for a ticket given a routing rule and the list of
 * available agents. Returns the agent ID or null if none qualifies.
 *
 * State tracking (round-robin index) must be maintained externally —
 * this function is stateless and selects from the provided list.
 *
 * @param rule - the routing rule to apply
 * @param availableAgents - agents with capacity data
 * @param roundRobinIndex - current round-robin pointer (for round_robin strategy)
 */
export function selectAgent(
  rule: Pick<RoutingRuleRow, "strategy" | "criteria">,
  availableAgents: AgentCapacityRow[],
  roundRobinIndex = 0,
): { agentId: string | null; reason: string } {
  const eligible = availableAgents.filter(
    (a) => a.available && a.currentLoad < a.maxTickets,
  );

  if (eligible.length === 0) {
    return { agentId: null, reason: "no_available_agents" };
  }

  const strategy = rule.strategy as RoutingStrategy;

  switch (strategy) {
    case "round_robin": {
      const idx = roundRobinIndex % eligible.length;
      return { agentId: eligible[idx]!.agentId, reason: "round_robin_selected" };
    }

    case "weighted": {
      // Higher weight → higher probability of assignment.
      // Sort by current load ascending (prefer less loaded within weight groups).
      const sorted = [...eligible].sort((a, b) => {
        const loadRatioA = a.currentLoad / a.maxTickets;
        const loadRatioB = b.currentLoad / b.maxTickets;
        return loadRatioA - loadRatioB;
      });
      return { agentId: sorted[0]!.agentId, reason: "weighted_least_loaded" };
    }

    case "skill_based": {
      const requiredSkills = extractRequiredSkills(rule.criteria);
      if (requiredSkills.length === 0) {
        // No skills required — fall back to least loaded
        const sorted = [...eligible].sort((a, b) => a.currentLoad - b.currentLoad);
        return { agentId: sorted[0]!.agentId, reason: "skill_based_no_skills_required" };
      }

      const matched = eligible.filter((a) => {
        const agentSkills = (a.skills as string[] | null) ?? [];
        return requiredSkills.every((s) => agentSkills.includes(s));
      });

      if (matched.length === 0) {
        return { agentId: null, reason: "no_agents_with_required_skills" };
      }

      // Among matched, pick least loaded
      const sorted = [...matched].sort((a, b) => a.currentLoad - b.currentLoad);
      return { agentId: sorted[0]!.agentId, reason: "skill_based_matched" };
    }

    case "least_busy": {
      const sorted = [...eligible].sort((a, b) => a.currentLoad - b.currentLoad);
      return { agentId: sorted[0]!.agentId, reason: "least_busy_selected" };
    }

    default:
      return { agentId: null, reason: `unknown_strategy: ${strategy}` };
  }
}

// ─── validateRulePrecedence ───────────────────────────────────────────────────

/**
 * Validate that rules have sensible ordinal ordering.
 * Returns issues if multiple enabled rules share the same ordinal.
 */
export function validateRulePrecedence(
  rules: Pick<RoutingRuleRow, "id" | "name" | "ordinal" | "enabled">[],
): string[] {
  const issues: string[] = [];
  const enabledRules = rules.filter((r) => r.enabled);

  // Check for duplicate ordinals
  const ordinalMap = new Map<number, typeof enabledRules>();
  for (const rule of enabledRules) {
    const existing = ordinalMap.get(rule.ordinal) ?? [];
    existing.push(rule);
    ordinalMap.set(rule.ordinal, existing);
  }

  for (const [ordinal, group] of ordinalMap) {
    if (group.length > 1) {
      const names = group.map((r) => `"${r.name}"`).join(", ");
      issues.push(`Duplicate ordinal ${ordinal}: ${names}`);
    }
  }

  return issues;
}

// ─── detectConflicts ──────────────────────────────────────────────────────────

/**
 * Detect conflicts between routing rules. Two rules conflict when:
 * 1. Both are enabled
 * 2. They have overlapping criteria (same priority/category match)
 * 3. They would compete for the same tickets
 */
export function detectConflicts(
  rules: Pick<RoutingRuleRow, "id" | "name" | "strategy" | "criteria" | "ordinal" | "enabled">[],
): RoutingConflict[] {
  const conflicts: RoutingConflict[] = [];
  const enabledRules = rules.filter((r) => r.enabled);

  for (let i = 0; i < enabledRules.length; i++) {
    for (let j = i + 1; j < enabledRules.length; j++) {
      const ruleA = enabledRules[i]!;
      const ruleB = enabledRules[j]!;

      if (criteriaOverlap(ruleA.criteria, ruleB.criteria)) {
        const reason =
          ruleA.ordinal === ruleB.ordinal
            ? "same ordinal with overlapping criteria — execution order is ambiguous"
            : "overlapping criteria — higher ordinal rule may never execute";

        conflicts.push({
          ruleA: { id: ruleA.id, name: ruleA.name, ordinal: ruleA.ordinal },
          ruleB: { id: ruleB.id, name: ruleB.name, ordinal: ruleB.ordinal },
          reason,
        });
      }
    }
  }

  return conflicts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractRequiredSkills(criteria: Record<string, unknown> | null | undefined): string[] {
  if (!criteria) return [];
  const skills = criteria["requiredSkills"];
  if (Array.isArray(skills)) {
    return skills.filter((s): s is string => typeof s === "string");
  }
  return [];
}

/**
 * Determine if two criteria objects overlap. Overlap means they could both
 * match the same ticket. If criteria is null/undefined, it matches everything.
 */
function criteriaOverlap(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  // Null criteria matches everything — always overlaps
  if (!a || !b) return true;
  if (Object.keys(a).length === 0 || Object.keys(b).length === 0) return true;

  // Check for common criteria keys with same values
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  const commonKeys = aKeys.filter((k) => bKeys.includes(k));

  if (commonKeys.length === 0) {
    // Different criteria dimensions — could both match same ticket
    return true;
  }

  // If they share criteria keys, check if values overlap
  for (const key of commonKeys) {
    const aVal = a[key];
    const bVal = b[key];

    // Arrays: check intersection
    if (Array.isArray(aVal) && Array.isArray(bVal)) {
      const hasOverlap = aVal.some((v) => bVal.includes(v));
      if (!hasOverlap) return false;
    } else if (aVal !== bVal) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that a strategy string is one of the allowed values.
 */
export function isValidStrategy(strategy: string): strategy is RoutingStrategy {
  return (VALID_STRATEGIES as readonly string[]).includes(strategy);
}
