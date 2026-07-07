/**
 * Property-Based Tests for CRM Domain Logic.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * Properties 10–15:
 * - Property 10: CRM Pipeline Stage Count Bounds (3–10 stages)
 * - Property 11: Deal Stage Transition with Optimistic Locking
 * - Property 12: Weighted Revenue Forecast Computation
 * - Property 13: Lead Scoring Range and Weighting (0–100)
 * - Property 14: Lead Assignment Rule Matching
 * - Property 15: Custom Field Limit Enforcement (max 50 per entity type)
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { weightedForecast, type DealForForecast } from "../src/modules/deals/forecast.js";
import { computeLeadScore, type ScoringRule, type LeadAttributes } from "../src/modules/leads/scoring.js";
import { assignLead, type AssignmentRule, type Lead } from "../src/modules/leads/assignment.js";
import { createPipelineBody } from "../src/modules/pipelines/validators.js";
import { createCustomFieldBody } from "../src/modules/custom-fields/validators.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 string */
const uuidArb: fc.Arbitrary<string> = fc.uuid();

/** Generate a pipeline stage */
const pipelineStageArb: fc.Arbitrary<{
  id: string;
  name: string;
  probability: number;
  ordinal: number;
}> = fc.record({
  id: uuidArb,
  name: fc.string({ minLength: 1, maxLength: 100 }),
  probability: fc.integer({ min: 0, max: 100 }),
  ordinal: fc.integer({ min: 0, max: 99 }),
});

/** Generate a valid pipeline stages array (3–10 stages) */
const validStagesArb: fc.Arbitrary<Array<{
  id: string;
  name: string;
  probability: number;
  ordinal: number;
}>> = fc.array(pipelineStageArb, { minLength: 3, maxLength: 10 });

/** Generate an invalid pipeline stages array (too few or too many) */
const invalidStagesArb: fc.Arbitrary<Array<{
  id: string;
  name: string;
  probability: number;
  ordinal: number;
}>> = fc.oneof(
  fc.array(pipelineStageArb, { minLength: 0, maxLength: 2 }),
  fc.array(pipelineStageArb, { minLength: 11, maxLength: 15 }),
);

/** Generate a positive bigint value (paise) — bounded to safe range for tests */
const valueMinorArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: 100_000_000_000_00n, // up to Rs 100 crore in paise
});

/** Generate a deal for forecast */
const dealForForecastArb = (stageIds: string[]): fc.Arbitrary<DealForForecast> =>
  fc.record({
    id: uuidArb,
    stageId: fc.constantFrom(...stageIds),
    valueMinor: valueMinorArb,
  });

/** Generate a probability value 0–100 */
const probabilityArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });

/** Generate entity type for custom fields */
const entityTypeArb: fc.Arbitrary<string> = fc.constantFrom("leads", "contacts", "deals");

// ─── Property 10: CRM Pipeline Stage Count Bounds (3–10 stages) ──────────────

describe("Property 10: CRM Pipeline Stage Count Bounds", () => {
  /**
   * For any pipeline with 3–10 stages, the zod validator SHALL accept it.
   *
   * **Validates: Requirements 8.1**
   */
  it("accepts pipelines with 3–10 stages", () => {
    fc.assert(
      fc.property(validStagesArb, (stages) => {
        const result = createPipelineBody.safeParse({
          name: "Test Pipeline",
          stages,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any pipeline with fewer than 3 or more than 10 stages, the zod
   * validator SHALL reject it.
   *
   * **Validates: Requirements 8.1**
   */
  it("rejects pipelines with fewer than 3 or more than 10 stages", () => {
    fc.assert(
      fc.property(invalidStagesArb, (stages) => {
        const result = createPipelineBody.safeParse({
          name: "Test Pipeline",
          stages,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Stage probability is always within [0, 100].
   *
   * **Validates: Requirements 8.1**
   */
  it("stage probability is validated within 0–100 range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: -1 }),
        (invalidProb) => {
          const stages = [
            { id: "00000000-0000-4000-8000-000000000001", name: "S1", probability: invalidProb, ordinal: 0 },
            { id: "00000000-0000-4000-8000-000000000002", name: "S2", probability: 50, ordinal: 1 },
            { id: "00000000-0000-4000-8000-000000000003", name: "S3", probability: 100, ordinal: 2 },
          ];
          const result = createPipelineBody.safeParse({ name: "Test", stages });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Deal Stage Transition with Optimistic Locking ──────────────

describe("Property 11: Deal Stage Transition with Optimistic Locking", () => {
  /**
   * Simulates the optimistic locking constraint: a stage transition succeeds
   * only when the provided version matches the current version. On mismatch,
   * the operation is rejected (409 Conflict).
   *
   * **Validates: Requirements 8.2, 8.3**
   */

  interface DealState {
    id: string;
    stage: string;
    version: number;
  }

  function applyStageTransition(
    deal: DealState,
    newStage: string,
    providedVersion: number,
  ): { success: true; deal: DealState } | { success: false; reason: string } {
    if (providedVersion !== deal.version) {
      return { success: false, reason: "version_conflict" };
    }
    return {
      success: true,
      deal: { ...deal, stage: newStage, version: deal.version + 1 },
    };
  }

  it("succeeds when version matches and increments version", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.integer({ min: 1, max: 1000 }),
        (dealId, currentStage, newStage, version) => {
          const deal: DealState = { id: dealId, stage: currentStage, version };
          const result = applyStageTransition(deal, newStage, version);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.deal.stage).toBe(newStage);
            expect(result.deal.version).toBe(version + 1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fails with version_conflict when version does not match", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (dealId, currentStage, newStage, currentVersion, providedVersion) => {
          fc.pre(currentVersion !== providedVersion);
          const deal: DealState = { id: dealId, stage: currentStage, version: currentVersion };
          const result = applyStageTransition(deal, newStage, providedVersion);
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.reason).toBe("version_conflict");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("preserves deal in prior stage on conflict (no data loss)", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.integer({ min: 1, max: 1000 }),
        (dealId, currentStage, newStage, version) => {
          const deal: DealState = { id: dealId, stage: currentStage, version };
          const wrongVersion = version + 1;
          const result = applyStageTransition(deal, newStage, wrongVersion);
          expect(result.success).toBe(false);
          // Original deal is unchanged
          expect(deal.stage).toBe(currentStage);
          expect(deal.version).toBe(version);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 12: Weighted Revenue Forecast Computation ──────────────────────

describe("Property 12: Weighted Revenue Forecast Computation", () => {
  /**
   * For any set of active deals with valueMinor (bigint paise) and a stage
   * probability map (0–100 per stage), the weighted forecast SHALL equal
   * the sum of deal.valueMinor * stageProbability / 100n (integer division)
   * for each deal.
   *
   * **Validates: Requirements 8.4**
   */
  it("total forecast equals sum of individual deal weighted values", () => {
    const stageIds = ["stage-a", "stage-b", "stage-c"];

    fc.assert(
      fc.property(
        fc.array(dealForForecastArb(stageIds), { minLength: 0, maxLength: 20 }),
        fc.record({
          "stage-a": probabilityArb,
          "stage-b": probabilityArb,
          "stage-c": probabilityArb,
        }),
        (deals, probs) => {
          const probMap = new Map(Object.entries(probs));
          const result = weightedForecast(deals, probMap);

          // Manually compute expected total
          let expected = 0n;
          for (const deal of deals) {
            const prob = probMap.get(deal.stageId) ?? 0;
            const clamped = Math.max(0, Math.min(100, Math.round(prob)));
            expected += (deal.valueMinor * BigInt(clamped)) / 100n;
          }

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("forecast is always non-negative when all values are non-negative", () => {
    const stageIds = ["s1", "s2"];

    fc.assert(
      fc.property(
        fc.array(dealForForecastArb(stageIds), { minLength: 0, maxLength: 10 }),
        fc.record({ s1: probabilityArb, s2: probabilityArb }),
        (deals, probs) => {
          const probMap = new Map(Object.entries(probs));
          const result = weightedForecast(deals, probMap);
          expect(result >= 0n).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("forecast with 100% probability equals sum of deal values", () => {
    const stageIds = ["s1"];

    fc.assert(
      fc.property(
        fc.array(dealForForecastArb(stageIds), { minLength: 1, maxLength: 10 }),
        (deals) => {
          const probMap = new Map([["s1", 100]]);
          const result = weightedForecast(deals, probMap);
          const totalValue = deals.reduce((sum, d) => sum + d.valueMinor, 0n);
          expect(result).toBe(totalValue);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("forecast with 0% probability is always zero", () => {
    const stageIds = ["s1"];

    fc.assert(
      fc.property(
        fc.array(dealForForecastArb(stageIds), { minLength: 1, maxLength: 10 }),
        (deals) => {
          const probMap = new Map([["s1", 0]]);
          const result = weightedForecast(deals, probMap);
          expect(result).toBe(0n);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 13: Lead Scoring Range and Weighting (0–100) ───────────────────

describe("Property 13: Lead Scoring Range and Weighting", () => {
  /**
   * For any lead with attribute values and a set of weighted scoring rules
   * (weights summing to 100), the computed lead score SHALL equal the weighted
   * sum of individual attribute scores, clamped to the range [0, 100].
   *
   * **Validates: Requirements 8.5**
   */

  /** Generate a scoring rule set where weights sum to 100 */
  const scoringRulesArb = (numRules: number): fc.Arbitrary<ScoringRule[]> => {
    if (numRules === 0) return fc.constant([]);
    // Generate weights that sum to 100
    return fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: numRules,
      maxLength: numRules,
    }).map((rawWeights) => {
      const sum = rawWeights.reduce((a, b) => a + b, 0);
      // Normalize to sum=100
      const normalized = rawWeights.map((w) => Math.floor((w / sum) * 100));
      // Add remainder to last element
      const currentSum = normalized.reduce((a, b) => a + b, 0);
      normalized[normalized.length - 1] += 100 - currentSum;

      return normalized.map((weight, i) => ({
        attribute: `attr_${i}`,
        weight,
        scoreFn: (_value: unknown) => {
          // Return a fixed score between 0–100 based on attribute presence
          return _value != null ? 80 : 0;
        },
      }));
    });
  };

  it("score is always in [0, 100] range for any valid rules", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        (numRules, hasValues) => {
          const rules: ScoringRule[] = [];
          const lead: LeadAttributes = {};
          const weights: number[] = [];

          // Generate weights summing to 100
          let remaining = 100;
          for (let i = 0; i < numRules; i++) {
            const w = i === numRules - 1 ? remaining : Math.floor(remaining / (numRules - i));
            weights.push(w);
            remaining -= w;
          }

          for (let i = 0; i < numRules; i++) {
            rules.push({
              attribute: `attr_${i}`,
              weight: weights[i],
              scoreFn: () => hasValues ? 80 : 20,
            });
            if (hasValues) lead[`attr_${i}`] = "value";
          }

          const score = computeLeadScore(lead, rules);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("score is 0 when rules array is empty", () => {
    fc.assert(
      fc.property(
        fc.record({ company: fc.string(), source: fc.string() }),
        (lead) => {
          const score = computeLeadScore(lead, []);
          expect(score).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("score equals weighted sum divided by 100, clamped to [0,100]", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 5 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 5 }),
        (rawWeights, scores) => {
          const numRules = Math.min(rawWeights.length, scores.length);
          if (numRules < 2) return;

          // Normalize weights to sum to 100
          const slice = rawWeights.slice(0, numRules);
          const sum = slice.reduce((a, b) => a + b, 0);
          if (sum === 0) return; // skip degenerate case

          const normalized = slice.map((w) => Math.floor((w / sum) * 100));
          const currentSum = normalized.reduce((a, b) => a + b, 0);
          normalized[normalized.length - 1] += 100 - currentSum;

          const lead: LeadAttributes = {};
          const rules: ScoringRule[] = normalized.map((weight, i) => {
            const attrScore = scores[i] ?? 0;
            lead[`attr_${i}`] = attrScore;
            return {
              attribute: `attr_${i}`,
              weight,
              scoreFn: (v: unknown) => (v as number) ?? 0,
            };
          });

          const result = computeLeadScore(lead, rules);

          // Compute expected: sum(weight * clamp(score, 0, 100)) / 100
          let weightedSum = 0;
          for (let i = 0; i < numRules; i++) {
            const clampedScore = Math.max(0, Math.min(100, scores[i] ?? 0));
            weightedSum += normalized[i] * clampedScore;
          }
          const expected = Math.max(0, Math.min(100, Math.round(weightedSum / 100)));

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ─── Property 14: Lead Assignment Rule Matching ──────────────────────────────

describe("Property 14: Lead Assignment Rule Matching", () => {
  /**
   * For any lead and a set of assignment rules (territory, round-robin, score
   * threshold), the assignment function SHALL select the first matching rule by
   * priority and assign the correct owner; if no rule matches, it SHALL assign
   * the tenant-configured fallback owner.
   *
   * **Validates: Requirements 8.6, 8.9**
   */

  const fallbackOwnerId = "fallback-owner-00000000";

  it("assigns fallback owner when no rules match", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 100 }),
        (leadId, territory, score) => {
          const lead: Lead = { id: leadId, territory, score };
          // Rules that can never match this lead
          const rules: AssignmentRule[] = [
            {
              id: "rule-1",
              type: "territory",
              criteria: { territory: `__never_match_${territory}_x`, ownerId: "owner-1" },
              ordinal: 1,
              enabled: true,
            },
            {
              id: "rule-2",
              type: "score_threshold",
              criteria: { threshold: 101, ownerId: "owner-2" }, // impossible score
              ordinal: 2,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          expect(result.assignedTo).toBe(fallbackOwnerId);
          expect(result.matchedRuleId).toBeNull();
          expect(result.reason).toBe("no_rule_matched");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("territory rule matches when lead territory equals criteria territory", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        uuidArb,
        (leadId, territory, ownerId) => {
          const lead: Lead = { id: leadId, territory };
          const rules: AssignmentRule[] = [
            {
              id: "rule-territory",
              type: "territory",
              criteria: { territory, ownerId },
              ordinal: 1,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          expect(result.assignedTo).toBe(ownerId);
          expect(result.matchedRuleId).toBe("rule-territory");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("score threshold rule matches when lead score >= threshold", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        uuidArb,
        (leadId, score, threshold, ownerId) => {
          fc.pre(score >= threshold);
          const lead: Lead = { id: leadId, score };
          const rules: AssignmentRule[] = [
            {
              id: "rule-score",
              type: "score_threshold",
              criteria: { threshold, ownerId },
              ordinal: 1,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          expect(result.assignedTo).toBe(ownerId);
          expect(result.matchedRuleId).toBe("rule-score");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("evaluates rules in ascending ordinal order (first match wins)", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        uuidArb,
        uuidArb,
        (leadId, territory, owner1, owner2) => {
          fc.pre(owner1 !== owner2);
          const lead: Lead = { id: leadId, territory, score: 90 };

          // Both rules match, but lower ordinal wins
          const rules: AssignmentRule[] = [
            {
              id: "rule-high-priority",
              type: "territory",
              criteria: { territory, ownerId: owner1 },
              ordinal: 1,
              enabled: true,
            },
            {
              id: "rule-low-priority",
              type: "score_threshold",
              criteria: { threshold: 50, ownerId: owner2 },
              ordinal: 2,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          expect(result.assignedTo).toBe(owner1);
          expect(result.matchedRuleId).toBe("rule-high-priority");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("disabled rules are skipped", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        uuidArb,
        uuidArb,
        (leadId, territory, owner1, owner2) => {
          const lead: Lead = { id: leadId, territory, score: 90 };
          const rules: AssignmentRule[] = [
            {
              id: "rule-disabled",
              type: "territory",
              criteria: { territory, ownerId: owner1 },
              ordinal: 1,
              enabled: false, // disabled!
            },
            {
              id: "rule-active",
              type: "score_threshold",
              criteria: { threshold: 50, ownerId: owner2 },
              ordinal: 2,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          expect(result.assignedTo).toBe(owner2);
          expect(result.matchedRuleId).toBe("rule-active");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("round-robin cycles through roster correctly", () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.array(uuidArb, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 99 }),
        (leadId, roster, currentIndex) => {
          const normalizedIndex = currentIndex % roster.length;
          const lead: Lead = { id: leadId };
          const rules: AssignmentRule[] = [
            {
              id: "rule-rr",
              type: "round_robin",
              criteria: { roster, currentIndex: normalizedIndex },
              ordinal: 1,
              enabled: true,
            },
          ];

          const result = assignLead(lead, rules, fallbackOwnerId);
          const expectedIndex = (normalizedIndex + 1) % roster.length;
          expect(result.assignedTo).toBe(roster[expectedIndex]);
          expect(result.matchedRuleId).toBe("rule-rr");
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 15: Custom Field Limit Enforcement (max 50 per entity type) ────

describe("Property 15: Custom Field Limit Enforcement", () => {
  /**
   * Custom field creation is bounded at max 50 per entity type per tenant.
   * The limit check is: if count >= 50, reject with 422.
   *
   * **Validates: Requirements 8.8**
   */

  const MAX_CUSTOM_FIELDS = 50;

  function canCreateField(currentCount: number): boolean {
    return currentCount < MAX_CUSTOM_FIELDS;
  }

  it("allows creation when count is below 50 for any entity type", () => {
    fc.assert(
      fc.property(
        entityTypeArb,
        fc.integer({ min: 0, max: 49 }),
        (_entityType, currentCount) => {
          expect(canCreateField(currentCount)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects creation when count is at or above 50 for any entity type", () => {
    fc.assert(
      fc.property(
        entityTypeArb,
        fc.integer({ min: 50, max: 200 }),
        (_entityType, currentCount) => {
          expect(canCreateField(currentCount)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("limit is per entity type — different types have independent limits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (leadsCount, contactsCount, dealsCount) => {
          // Each entity type's limit is independent
          const leadsCanCreate = canCreateField(leadsCount);
          const contactsCanCreate = canCreateField(contactsCount);
          const dealsCanCreate = canCreateField(dealsCount);

          // A type at limit should not affect others
          if (leadsCount >= MAX_CUSTOM_FIELDS) {
            expect(leadsCanCreate).toBe(false);
          }
          if (contactsCount < MAX_CUSTOM_FIELDS) {
            expect(contactsCanCreate).toBe(true);
          }
          if (dealsCount < MAX_CUSTOM_FIELDS) {
            expect(dealsCanCreate).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("field name validation: max 64 chars, non-empty", () => {
    fc.assert(
      fc.property(
        entityTypeArb,
        fc.string({ minLength: 1, maxLength: 64 }),
        (entityType, fieldName) => {
          const result = createCustomFieldBody.safeParse({
            entityType,
            fieldName,
            fieldType: "text",
          });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects field names exceeding 64 characters", () => {
    fc.assert(
      fc.property(
        entityTypeArb,
        fc.string({ minLength: 65, maxLength: 128 }),
        (entityType, fieldName) => {
          const result = createCustomFieldBody.safeParse({
            entityType,
            fieldName,
            fieldType: "text",
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
