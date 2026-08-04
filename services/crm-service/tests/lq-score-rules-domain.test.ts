/** LQ-002 pure scoring-rule domain tests (buildScoreFn + defaults). */
import { describe, it, expect } from "vitest";
import {
  buildScoreFn,
  toScoringRules,
  DEFAULT_SCORE_RULE_CONFIGS,
  type StoredScoreRule,
} from "../src/modules/leads/score-rules-domain.js";
import { computeLeadScore } from "../src/modules/leads/scoring.js";

describe("buildScoreFn — presence", () => {
  const fn = buildScoreFn("presence", { present: 80, absent: 10 });
  it("present value", () => expect(fn("acme")).toBe(80));
  it("absent (null)", () => expect(fn(null)).toBe(10));
  it("absent (empty string)", () => expect(fn("")).toBe(10));
  it("defaults present=100/absent=0", () => {
    const d = buildScoreFn("presence", {});
    expect(d("x")).toBe(100);
    expect(d(null)).toBe(0);
  });
});

describe("buildScoreFn — map", () => {
  const fn = buildScoreFn("map", { values: { referral: 90, website: 70 }, default: 20 });
  it("known key", () => expect(fn("referral")).toBe(90));
  it("case-insensitive", () => expect(fn("Website")).toBe(70));
  it("unknown → default", () => expect(fn("billboard")).toBe(20));
  it("null → default", () => expect(fn(null)).toBe(20));
});

describe("buildScoreFn — recency", () => {
  const fn = buildScoreFn("recency", {
    tiers: [{ maxDays: 7, score: 100 }, { maxDays: 30, score: 60 }],
    beyondScore: 20,
    absentScore: 5,
  });
  it("recent → top tier", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(fn(twoDaysAgo)).toBe(100);
  });
  it("mid → middle tier", () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 86400000).toISOString();
    expect(fn(twentyDaysAgo)).toBe(60);
  });
  it("old → beyond", () => {
    const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
    expect(fn(longAgo)).toBe(20);
  });
  it("absent → absentScore", () => expect(fn(null)).toBe(5));
  it("invalid date → absentScore", () => expect(fn("not-a-date")).toBe(5));
});

describe("buildScoreFn — numeric_threshold", () => {
  const fn = buildScoreFn("numeric_threshold", {
    tiers: [{ min: 0, score: 10 }, { min: 1000, score: 60 }, { min: 100000, score: 100 }],
    default: 0,
  });
  it("mid tier", () => expect(fn(5000)).toBe(60));
  it("top tier", () => expect(fn(200000)).toBe(100));
  it("below all tiers uses lowest matching (min 0)", () => expect(fn(5)).toBe(10));
  it("null → default", () => expect(fn(null)).toBe(0));
  it("non-numeric → default", () => expect(fn("abc")).toBe(0));
});

describe("buildScoreFn — unknown type", () => {
  it("returns 0", () => expect(buildScoreFn("nope" as never, {})("x")).toBe(0));
});

describe("toScoringRules", () => {
  it("drops disabled rules and builds executable scoreFns", () => {
    const stored: StoredScoreRule[] = [
      { attribute: "email", weight: 50, scoreFnType: "presence", params: { present: 80, absent: 10 }, enabled: true },
      { attribute: "company", weight: 50, scoreFnType: "presence", params: {}, enabled: false },
    ];
    const rules = toScoringRules(stored);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.attribute).toBe("email");
    expect(rules[0]!.scoreFn("x@y.com")).toBe(80);
  });
});

describe("DEFAULT_SCORE_RULE_CONFIGS reproduce the historical defaults", () => {
  it("weights sum to 100", () => {
    expect(DEFAULT_SCORE_RULE_CONFIGS.reduce((s, r) => s + r.weight, 0)).toBe(100);
  });
  it("a strong lead scores high, a weak lead scores low", () => {
    const rules = toScoringRules(DEFAULT_SCORE_RULE_CONFIGS);
    const strong = computeLeadScore(
      { leadSource: "referral", company: "Acme", email: "a@b.com", lastActivityAt: new Date().toISOString() },
      rules,
    );
    const weak = computeLeadScore({ leadSource: "unknown", company: null, email: null, lastActivityAt: null }, rules);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThan(70);
  });
});
