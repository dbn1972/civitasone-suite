/**
 * Onboarding health metric domain — pure functions (G19).
 *
 * The health score is a weighted average of milestone checks. Each rule defines
 * an expected milestone event and a deadline (expected_within_days from case
 * creation). A milestone is "hit" if the event occurred within the window, and
 * "overdue" if the window has elapsed without the event.
 *
 * Score semantics:
 * - 100 = all active milestones hit on time
 * - 0   = all milestones overdue and none hit
 * - In between = weighted proportion of milestones hit
 *
 * The score only counts ACTIVE rules. Inactive rules are ignored entirely so
 * tenants can disable a check without deleting history.
 */

import type { MilestoneResult } from "./schema.js";

export interface HealthRule {
  ruleKey: string;
  milestoneEvent: string;
  expectedWithinDays: number;
  weight: number;
  active: boolean;
}

export interface MilestoneEvent {
  eventType: string;
  occurredAt: Date;
}

export interface ComputeHealthResult {
  score: number;
  milestones: MilestoneResult[];
}

/**
 * Whether a milestone has been achieved: the event exists and occurred before
 * the deadline.
 */
export function isMilestoneHit(
  rule: HealthRule,
  events: MilestoneEvent[],
  caseCreatedAt: Date,
): boolean {
  const deadline = new Date(caseCreatedAt.getTime() + rule.expectedWithinDays * 86_400_000);
  return events.some(
    (e) => e.eventType === rule.milestoneEvent && e.occurredAt <= deadline,
  );
}

/**
 * Whether the milestone's deadline has passed without the event occurring
 * (at all, regardless of timing).
 */
export function isMilestoneOverdue(
  rule: HealthRule,
  events: MilestoneEvent[],
  caseCreatedAt: Date,
  now: Date,
): boolean {
  const deadline = new Date(caseCreatedAt.getTime() + rule.expectedWithinDays * 86_400_000);
  if (now <= deadline) return false;
  return !events.some((e) => e.eventType === rule.milestoneEvent);
}

/**
 * Compute the composite onboarding health score from a set of rules and events.
 *
 * Only active rules participate. If no active rules exist, the score is 100
 * (healthy by default — no expectations to fail).
 *
 * The score is a weighted average where each milestone contributes:
 * - its full weight if hit on time
 * - zero if overdue or not yet hit
 *
 * A milestone that is neither hit nor overdue (still within the window) is
 * treated as "pending" and contributes zero to the score. This means the score
 * can only improve over time (events arrive) or drop when a deadline passes.
 */
export function computeOnboardingHealth(
  rules: HealthRule[],
  events: MilestoneEvent[],
  caseCreatedAt: Date,
  now: Date,
): ComputeHealthResult {
  const activeRules = rules.filter((r) => r.active);

  if (activeRules.length === 0) {
    return { score: 100, milestones: [] };
  }

  const totalWeight = activeRules.reduce((sum, r) => sum + r.weight, 0);

  if (totalWeight === 0) {
    return {
      score: 100,
      milestones: activeRules.map((r) => ({
        ruleKey: r.ruleKey,
        milestoneEvent: r.milestoneEvent,
        hit: isMilestoneHit(r, events, caseCreatedAt),
        overdue: isMilestoneOverdue(r, events, caseCreatedAt, now),
        weight: r.weight,
      })),
    };
  }

  let achievedWeight = 0;
  const milestones: MilestoneResult[] = [];

  for (const rule of activeRules) {
    const hit = isMilestoneHit(rule, events, caseCreatedAt);
    const overdue = isMilestoneOverdue(rule, events, caseCreatedAt, now);

    if (hit) {
      achievedWeight += rule.weight;
    }

    milestones.push({
      ruleKey: rule.ruleKey,
      milestoneEvent: rule.milestoneEvent,
      hit,
      overdue,
      weight: rule.weight,
    });
  }

  const score = Math.round((achievedWeight / totalWeight) * 100);

  return { score, milestones };
}
