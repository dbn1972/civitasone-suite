/**
 * W2 crm cluster 07 (rework) -- GAP-CRM-LEAD-SCORING-02, the params contract of each score
 * function, checked at the schema (no database): everything the schema accepts must be
 * something buildScoreFn can build and run, and everything buildScoreFn cannot run must be
 * refused. The route-level 400s are covered in w2-crm07-lead-score-preview.test.ts.
 */
import { describe, it, expect } from "vitest";
import { putScoreRulesBody, previewScoreRulesBody } from "../src/modules/leads/score-rules-validators.js";
import { buildScoreFn, DEFAULT_SCORE_RULE_CONFIGS, type ScoreFnType } from "../src/modules/leads/score-rules-domain.js";

const ATTRIBUTE_FOR: Record<ScoreFnType, string> = {
  presence: "company",
  map: "leadSource",
  recency: "lastActivityAt",
  numeric_threshold: "city",
};
const rule = (scoreFnType: string, params: unknown, attribute?: string) => ({
  attribute: attribute ?? ATTRIBUTE_FOR[scoreFnType as ScoreFnType] ?? "company",
  weight: 10,
  scoreFnType,
  params,
  enabled: true,
});
const issuePaths = (rules: unknown[]) => {
  const r = putScoreRulesBody.safeParse({ rules });
  return r.success ? null : r.error.issues.map((i) => i.path.join("."));
};

describe("score-function params schema", () => {
  it("accepts the seeded default rules (so a GET -> edit -> PUT round trip works)", () => {
    for (const d of DEFAULT_SCORE_RULE_CONFIGS) {
      expect(putScoreRulesBody.safeParse({ rules: [d] }).success, d.attribute).toBe(true);
    }
  });

  it("returns the params untouched, including keys the scorer does not read", () => {
    const params = { values: { referral: 90 }, default: 20, note: "kept" };
    const r = putScoreRulesBody.parse({ rules: [rule("map", params)] });
    expect(r.rules[0]!.params).toEqual(params);
  });

  it("an omitted params is the empty object", () => {
    const r = putScoreRulesBody.parse({ rules: [{ attribute: "company", weight: 5, scoreFnType: "presence" }] });
    expect(r.rules[0]!.params).toEqual({});
    expect(r.rules[0]!.enabled).toBe(true);
  });

  it("checks each kind against its own contract, not another kind's", () => {
    // `tiers` means something to recency and numeric_threshold, nothing to presence or map.
    expect(issuePaths([rule("recency", { tiers: 5 })])).toEqual(["rules.0.params.tiers"]);
    expect(issuePaths([rule("presence", { tiers: 5 })])).toBeNull();
    // recency tiers use maxDays, numeric_threshold tiers use min.
    expect(issuePaths([rule("recency", { tiers: [{ min: 1, score: 5 }] })])).toEqual(["rules.0.params.tiers.0.maxDays"]);
    expect(issuePaths([rule("numeric_threshold", { tiers: [{ maxDays: 1, score: 5 }] })])).toEqual(["rules.0.params.tiers.0.min"]);
  });

  it("refuses a non-finite number (JSON 1e999 parses to Infinity)", () => {
    expect(issuePaths([rule("presence", { present: Number.POSITIVE_INFINITY })])).toEqual(["rules.0.params.present"]);
    expect(issuePaths([rule("recency", { tiers: [{ maxDays: Number.POSITIVE_INFINITY, score: 10 }] })])).toEqual(["rules.0.params.tiers.0.maxDays"]);
    expect(issuePaths([rule("numeric_threshold", { tiers: [{ min: Number.NaN, score: 10 }] })])).toEqual(["rules.0.params.tiers.0.min"]);
  });

  it("accepts the boundary scores 0 and 100 and refuses just outside them", () => {
    expect(issuePaths([rule("presence", { present: 100, absent: 0 })])).toBeNull();
    expect(issuePaths([rule("presence", { present: 100.01 })])).toEqual(["rules.0.params.present"]);
    expect(issuePaths([rule("presence", { absent: -0.01 })])).toEqual(["rules.0.params.absent"]);
  });

  it("rejects a bad rule the same way for the preview body", () => {
    const r = previewScoreRulesBody.safeParse({ rules: [rule("recency", { tiers: 5 })] });
    expect(r.success).toBe(false);
  });

  it("reports every bad rule in one answer, each at its own position", () => {
    expect(
      issuePaths([
        rule("recency", { tiers: 5 }),
        rule("presence", { present: 70 }, "email"),
        rule("map", { values: { Referral: 1 } }),
      ]),
    ).toEqual(["rules.0.params.tiers", "rules.2.params.values.Referral"]);
  });
});

describe("the schema and buildScoreFn agree", () => {
  const accepted: Array<[ScoreFnType, Record<string, unknown>]> = [
    ["presence", {}],
    ["presence", { present: 70, absent: 20 }],
    ["map", {}],
    ["map", { values: {}, default: 0 }],
    ["map", { values: { referral: 90, cold_call: 30 }, default: 20 }],
    ["recency", {}],
    ["recency", { tiers: [] }],
    ["recency", { tiers: [{ maxDays: 30, score: 60 }, { maxDays: 7, score: 100 }], beyondScore: 20, absentScore: 10 }],
    ["numeric_threshold", {}],
    ["numeric_threshold", { tiers: [{ min: 100, score: 80 }, { min: -5, score: 0 }], default: 5 }],
  ];

  it.each(accepted)("%s %j is accepted and builds a scorer that returns 0-100", (type, params) => {
    expect(putScoreRulesBody.safeParse({ rules: [rule(type, params)] }).success).toBe(true);
    const fn = buildScoreFn(type, params);
    for (const v of [undefined, null, "", "referral", "REFERRAL", 0, 250, "not a number", new Date().toISOString(), "2001-01-01"]) {
      const score = fn(v);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("the shapes that make buildScoreFn throw are exactly the ones the schema refuses", () => {
    // recency / numeric_threshold `tiers` that is not an array: `.slice` on a number throws while
    // the scorer is built, which is what aborted every recalculation and preview for the tenant.
    expect(() => buildScoreFn("recency", { tiers: 5 })).toThrow();
    expect(() => buildScoreFn("numeric_threshold", { tiers: 5 })).toThrow();
    expect(putScoreRulesBody.safeParse({ rules: [rule("recency", { tiers: 5 })] }).success).toBe(false);
    expect(putScoreRulesBody.safeParse({ rules: [rule("numeric_threshold", { tiers: 5 })] }).success).toBe(false);
  });
});
