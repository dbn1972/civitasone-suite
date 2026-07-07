/**
 * Property-Based Tests for Helpdesk Domain Logic.
 * Uses fast-check to verify automation rule evaluation and SLA deadline computation.
 *
 * **Validates: Requirements 12.1, 12.6, 12.7**
 *
 * Property 23: Helpdesk Automation Rule Priority Matching
 * - For any set of automation rules (ordered by ordinal) and a ticket with given fields:
 *   1. Rules are evaluated in ascending ordinal order (first match wins)
 *   2. A matching rule triggers its configured action (assign, escalate, notify, change priority)
 *   3. If no rule matches, no action is taken (fallback = no-op)
 *   4. Disabled rules are skipped
 *   5. At most one rule fires per evaluation (first match)
 *
 * Property 24: SLA Deadline and Threshold Computation
 * - For any priority level and category, the SLA configuration defines response and resolution deadlines
 * - The at-risk threshold is always exactly 80% of the deadline
 * - The at-risk time always falls between current time and the deadline
 * - Deadline is always in the future relative to ticket creation time
 * - If priority changes, new deadline reflects the new priority's SLA
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateRules,
  type AutomationRule,
  type TicketForEvaluation,
} from "../src/modules/automation/domain.js";
import type { AutomationTrigger, AutomationAction } from "../src/modules/automation/schema.js";
import {
  computeDeadlines,
  isAtRisk,
  isBreached,
  evaluateSlaStatus,
  resolvePolicy,
  type SlaPolicy,
} from "../src/modules/sla/domain.js";

// ─── Arbitraries for Property 23 ─────────────────────────────────────────────

/** Generates a valid field name for trigger conditions */
const fieldNameArb: fc.Arbitrary<string> = fc.constantFrom(
  "priority",
  "status",
  "category",
  "type",
  "channel",
);

/** Generates a field value */
const fieldValueArb: fc.Arbitrary<string> = fc.constantFrom(
  "critical",
  "high",
  "medium",
  "low",
  "open",
  "network",
  "hardware",
  "software",
);

/** Generates an automation trigger */
const triggerArb: fc.Arbitrary<AutomationTrigger> = fc.oneof(
  fc.record({
    type: fc.constant("field_match" as const),
    field: fieldNameArb,
    value: fieldValueArb,
  }),
  fc.record({
    type: fc.constant("time_elapsed" as const),
    thresholdMinutes: fc.integer({ min: 1, max: 1440 }),
  }),
  fc.record({
    type: fc.constant("keyword_match" as const),
    keywords: fc.array(fc.string({ minLength: 2, maxLength: 6 }), {
      minLength: 1,
      maxLength: 5,
    }),
  }),
);

/** Generates a valid automation action */
const actionArb: fc.Arbitrary<AutomationAction> = fc.oneof(
  fc.record({ type: fc.constant("assign" as const), to: fc.uuid() }),
  fc.record({ type: fc.constant("escalate" as const), level: fc.integer({ min: 1, max: 5 }) }),
  fc.record({
    type: fc.constant("notify" as const),
    channel: fc.constantFrom("email", "sms", "push"),
    recipients: fc.array(fc.uuid(), { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    type: fc.constant("change_priority" as const),
    newPriority: fc.constantFrom("critical", "high", "medium", "low"),
  }),
);

/** Generates a single automation rule */
const ruleArb = (ordinal: number, enabled: boolean): fc.Arbitrary<AutomationRule> =>
  fc.record({
    id: fc.uuid(),
    name: fc.constant(`Rule ${ordinal}`),
    ordinal: fc.constant(ordinal),
    enabled: fc.constant(enabled),
    trigger: triggerArb,
    actions: fc.array(actionArb, { minLength: 1, maxLength: 3 }),
  });

/** Generates a set of 1-100 automation rules with unique ordinals */
const rulesSetArb: fc.Arbitrary<AutomationRule[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) =>
        ruleArb(i + 1, true),
      ),
    ),
  )
  .map((rules) => rules as AutomationRule[]);

/** Generates a ticket for rule evaluation */
const ticketArb: fc.Arbitrary<TicketForEvaluation> = fc.record({
  fields: fc.dictionary(fieldNameArb, fieldValueArb, { minKeys: 1, maxKeys: 5 }),
  elapsedMinutes: fc.integer({ min: 0, max: 2880 }),
  subject: fc.string({ minLength: 3, maxLength: 50 }),
  description: fc.option(
    fc.string({ minLength: 3, maxLength: 100 }),
    { nil: undefined },
  ),
});

// ─── Arbitraries for Property 24 ─────────────────────────────────────────────

/** Generates a priority string */
const priorityArb: fc.Arbitrary<string> = fc.constantFrom("critical", "high", "medium", "low");

/** Generates a category string */
const categoryArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom("network", "hardware", "software", "security"),
);

/** Generates a valid SLA policy with positive response and resolution minutes */
const slaPolicyArb: fc.Arbitrary<SlaPolicy> = fc.record({
  id: fc.uuid(),
  tenantId: fc.uuid(),
  priority: priorityArb,
  category: categoryArb,
  responseMinutes: fc.integer({ min: 1, max: 10080 }), // up to 7 days
  resolutionMinutes: fc.integer({ min: 2, max: 20160 }), // up to 14 days
}).filter((p) => p.resolutionMinutes > p.responseMinutes);

/** Generates a ticket creation timestamp (recent past) */
const createdAtArb: fc.Arbitrary<Date> = fc
  .integer({ min: 1_700_000_000_000, max: 1_720_000_000_000 })
  .map((ms) => new Date(ms));

// ─── Property 23 Tests ────────────────────────────────────────────────────────

describe("Property 23: Helpdesk Automation Rule Priority Matching", () => {
  it("evaluates rules in ascending ordinal order (first match wins)", () => {
    fc.assert(
      fc.property(ticketArb, rulesSetArb, (ticket, rules) => {
        const result = evaluateRules(ticket, rules);

        if (result === null) {
          // No rule matched — verify none should match
          const sorted = [...rules]
            .filter((r) => r.enabled)
            .sort((a, b) => a.ordinal - b.ordinal);
          // Confirm no enabled rule matches this ticket by re-evaluating individually
          for (const rule of sorted) {
            const singleResult = evaluateRules(ticket, [rule]);
            expect(singleResult).toBeNull();
          }
        } else {
          // A rule fired — verify it's the FIRST matching one by ordinal
          const sorted = [...rules]
            .filter((r) => r.enabled)
            .sort((a, b) => a.ordinal - b.ordinal);

          // All enabled rules with lower ordinal must NOT match
          for (const rule of sorted) {
            if (rule.ordinal < result.ordinal) {
              const shouldNotMatch = evaluateRules(ticket, [rule]);
              expect(shouldNotMatch).toBeNull();
            } else {
              break;
            }
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("disabled rules are skipped and never fire", () => {
    fc.assert(
      fc.property(ticketArb, rulesSetArb, (ticket, rules) => {
        // Disable all rules
        const allDisabled = rules.map((r) => ({ ...r, enabled: false }));
        const result = evaluateRules(ticket, allDisabled);
        expect(result).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it("at most one rule fires per evaluation", () => {
    fc.assert(
      fc.property(ticketArb, rulesSetArb, (ticket, rules) => {
        const result = evaluateRules(ticket, rules);
        // evaluateRules returns either null or a single MatchedRule — never an array of multiple
        if (result !== null) {
          expect(result.ruleId).toBeDefined();
          expect(result.actions.length).toBeGreaterThanOrEqual(1);
          // Verify it's truly from one of the input rules
          const sourceRule = rules.find((r) => r.id === result.ruleId);
          expect(sourceRule).toBeDefined();
        }
      }),
      { numRuns: 500 },
    );
  });

  it("if no rule matches, no action is taken (null returned)", () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        // Create rules with impossible conditions
        const impossibleRules: AutomationRule[] = [
          {
            id: "impossible-1",
            name: "Impossible Rule 1",
            ordinal: 1,
            enabled: true,
            trigger: { type: "field_match", field: "nonexistent_field_xyz", value: "impossible_value_xyz" },
            actions: [{ type: "assign", to: "user-1" }],
          },
          {
            id: "impossible-2",
            name: "Impossible Rule 2",
            ordinal: 2,
            enabled: true,
            trigger: { type: "time_elapsed", thresholdMinutes: 999_999 },
            actions: [{ type: "escalate", level: 3 }],
          },
        ];
        const result = evaluateRules(ticket, impossibleRules);
        expect(result).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("a matching rule triggers its configured actions", () => {
    fc.assert(
      fc.property(ticketArb, rulesSetArb, (ticket, rules) => {
        const result = evaluateRules(ticket, rules);

        if (result !== null) {
          // The fired rule's actions must be exactly those from the source rule
          const sourceRule = rules.find((r) => r.id === result.ruleId);
          expect(sourceRule).toBeDefined();
          expect(result.actions).toEqual(sourceRule!.actions);
          expect(result.ordinal).toBe(sourceRule!.ordinal);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("result is deterministic: same input always produces the same output", () => {
    fc.assert(
      fc.property(ticketArb, rulesSetArb, (ticket, rules) => {
        const result1 = evaluateRules(ticket, rules);
        const result2 = evaluateRules(ticket, rules);

        if (result1 === null) {
          expect(result2).toBeNull();
        } else {
          expect(result2).not.toBeNull();
          expect(result2!.ruleId).toBe(result1.ruleId);
          expect(result2!.ordinal).toBe(result1.ordinal);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ─── Property 24 Tests ────────────────────────────────────────────────────────

describe("Property 24: SLA Deadline and Threshold Computation", () => {
  it("deadlines are always in the future relative to ticket creation time", () => {
    fc.assert(
      fc.property(createdAtArb, slaPolicyArb, (createdAt, policy) => {
        const deadlines = computeDeadlines(createdAt, policy);

        // Response deadline > createdAt
        expect(deadlines.responseDeadline.getTime()).toBeGreaterThan(createdAt.getTime());
        // Resolution deadline > createdAt
        expect(deadlines.resolutionDeadline.getTime()).toBeGreaterThan(createdAt.getTime());
        // Resolution deadline >= response deadline (resolutionMinutes > responseMinutes)
        expect(deadlines.resolutionDeadline.getTime()).toBeGreaterThan(
          deadlines.responseDeadline.getTime(),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("the at-risk threshold is exactly 80% of the resolution window", () => {
    fc.assert(
      fc.property(createdAtArb, slaPolicyArb, (createdAt, policy) => {
        const deadlines = computeDeadlines(createdAt, policy);
        const totalWindow = deadlines.resolutionDeadline.getTime() - createdAt.getTime();
        const threshold80 = totalWindow * 0.8;

        // Create a time at exactly 80% of the window
        const atRiskTime = new Date(createdAt.getTime() + threshold80);
        expect(isAtRisk(atRiskTime, createdAt, deadlines.resolutionDeadline)).toBe(true);

        // Just below 80% should NOT be at-risk
        const belowThreshold = new Date(createdAt.getTime() + threshold80 - 1);
        expect(isAtRisk(belowThreshold, createdAt, deadlines.resolutionDeadline)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("at-risk time always falls between creation and the deadline", () => {
    fc.assert(
      fc.property(createdAtArb, slaPolicyArb, (createdAt, policy) => {
        const deadlines = computeDeadlines(createdAt, policy);
        const totalWindow = deadlines.resolutionDeadline.getTime() - createdAt.getTime();
        const atRiskStart = createdAt.getTime() + totalWindow * 0.8;

        // The at-risk zone starts at 80% of the window
        expect(atRiskStart).toBeGreaterThan(createdAt.getTime());
        expect(atRiskStart).toBeLessThan(deadlines.resolutionDeadline.getTime());
      }),
      { numRuns: 500 },
    );
  });

  it("if priority changes, new deadline reflects the new priority SLA", () => {
    fc.assert(
      fc.property(
        createdAtArb,
        slaPolicyArb,
        slaPolicyArb,
        (createdAt, oldPolicy, newPolicy) => {
          const oldDeadlines = computeDeadlines(createdAt, oldPolicy);
          const newDeadlines = computeDeadlines(createdAt, newPolicy);

          // When policy changes, deadlines change accordingly
          if (oldPolicy.resolutionMinutes !== newPolicy.resolutionMinutes) {
            expect(oldDeadlines.resolutionDeadline.getTime()).not.toBe(
              newDeadlines.resolutionDeadline.getTime(),
            );
          }

          // New deadline should reflect new policy minutes
          const expectedResponseMs = createdAt.getTime() + newPolicy.responseMinutes * 60_000;
          const expectedResolutionMs = createdAt.getTime() + newPolicy.resolutionMinutes * 60_000;
          expect(newDeadlines.responseDeadline.getTime()).toBe(expectedResponseMs);
          expect(newDeadlines.resolutionDeadline.getTime()).toBe(expectedResolutionMs);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("breach detection: time past deadline always registers as breached", () => {
    fc.assert(
      fc.property(
        createdAtArb,
        slaPolicyArb,
        fc.integer({ min: 1, max: 100_000 }),
        (createdAt, policy, extraMs) => {
          const deadlines = computeDeadlines(createdAt, policy);
          // Time past the resolution deadline
          const afterBreach = new Date(deadlines.resolutionDeadline.getTime() + extraMs);
          expect(isBreached(afterBreach, deadlines.resolutionDeadline)).toBe(true);

          // Time before the resolution deadline
          const beforeDeadline = new Date(deadlines.resolutionDeadline.getTime() - 1);
          expect(isBreached(beforeDeadline, deadlines.resolutionDeadline)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("SLA status evaluation: breached > at_risk > within_sla precedence", () => {
    fc.assert(
      fc.property(createdAtArb, slaPolicyArb, (createdAt, policy) => {
        const deadlines = computeDeadlines(createdAt, policy);
        const totalWindow = deadlines.resolutionDeadline.getTime() - createdAt.getTime();

        // At 50% of window — within SLA
        const halfwayTime = new Date(createdAt.getTime() + totalWindow * 0.5);
        const halfResult = evaluateSlaStatus(halfwayTime, createdAt, policy);
        expect(halfResult.status).toBe("within_sla");

        // At 85% of window — at risk
        const atRiskTime = new Date(createdAt.getTime() + totalWindow * 0.85);
        const riskResult = evaluateSlaStatus(atRiskTime, createdAt, policy);
        expect(riskResult.status).toBe("at_risk");

        // After deadline — breached
        const breachedTime = new Date(deadlines.resolutionDeadline.getTime() + 1000);
        const breachResult = evaluateSlaStatus(breachedTime, createdAt, policy);
        expect(breachResult.status).toBe("breached");
      }),
      { numRuns: 500 },
    );
  });

  it("resolvePolicy prefers category-specific match over priority-only", () => {
    fc.assert(
      fc.property(
        priorityArb,
        fc.constantFrom("network", "hardware", "software", "security"),
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 501, max: 2000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 501, max: 2000 }),
        (priority, category, id1, id2, respMin1, resolMin1, respMin2, resolMin2) => {
          const tenantId = "tenant-1";
          const categorySpecific: SlaPolicy = {
            id: id1,
            tenantId,
            priority,
            category,
            responseMinutes: respMin1,
            resolutionMinutes: resolMin1,
          };
          const priorityOnly: SlaPolicy = {
            id: id2,
            tenantId,
            priority,
            category: null,
            responseMinutes: respMin2,
            resolutionMinutes: resolMin2,
          };

          const policies = [priorityOnly, categorySpecific]; // order shouldn't matter
          const resolved = resolvePolicy(policies, priority, category);

          // Should prefer the category-specific policy
          expect(resolved).not.toBeNull();
          expect(resolved!.id).toBe(categorySpecific.id);
        },
      ),
      { numRuns: 300 },
    );
  });
});
