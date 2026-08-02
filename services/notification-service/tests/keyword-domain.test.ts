/**
 * CR-MKT-06 — keyword normalisation, per-rule matching, precedence and the
 * auto-response plan. Pure domain.
 *
 * Precedence is the part that decides which reply a citizen actually receives
 * when several rules could fire, so every tier of the comparator is asserted in
 * isolation as well as in combination.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeKeyword,
  ruleMatches,
  compareRules,
  matchKeywordRule,
  planAutoResponse,
  type KeywordRule,
} from "../src/modules/inbox/keyword-domain.js";

function rule(over: Partial<KeywordRule> = {}): KeywordRule {
  return {
    id: "11111111-1111-4000-8000-000000000001",
    keyword: "STOP",
    matchType: "exact",
    priority: 100,
    channel: null,
    enabled: true,
    responseBody: "You have been unsubscribed.",
    action: null,
    ...over,
  };
}

describe("normalizeKeyword", () => {
  it("trims and lowercases", () => {
    expect(normalizeKeyword("  STOP  ")).toBe("stop");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeKeyword("stop   all    messages")).toBe("stop all messages");
  });

  it("strips leading punctuation", () => {
    expect(normalizeKeyword('"STOP')).toBe("stop");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeKeyword("STOP.")).toBe("stop");
  });

  it("strips punctuation on both sides", () => {
    expect(normalizeKeyword("*[STOP]!")).toBe("stop");
  });

  it("preserves internal punctuation", () => {
    expect(normalizeKeyword("stop-all")).toBe("stop-all");
  });

  it("preserves Unicode letters (Hindi keywords)", () => {
    expect(normalizeKeyword("  बंद।  ")).toBe("बंद");
  });

  it("preserves digits", () => {
    expect(normalizeKeyword("PLAN 2")).toBe("plan 2");
  });

  it("returns an empty string for punctuation only", () => {
    expect(normalizeKeyword("!!!")).toBe("");
  });

  it("returns an empty string for whitespace only", () => {
    expect(normalizeKeyword("   ")).toBe("");
  });

  it("normalises a newline as whitespace", () => {
    expect(normalizeKeyword("stop\nnow")).toBe("stop now");
  });
});

describe("ruleMatches", () => {
  it("exact matches the whole normalised message", () => {
    expect(ruleMatches(rule({ matchType: "exact" }), "stop")).toBe(true);
  });

  it("exact does not match a longer message", () => {
    expect(ruleMatches(rule({ matchType: "exact" }), "stop all")).toBe(false);
  });

  it("prefix matches the keyword alone", () => {
    expect(ruleMatches(rule({ matchType: "prefix" }), "stop")).toBe(true);
  });

  it("prefix matches at a word boundary", () => {
    expect(ruleMatches(rule({ matchType: "prefix" }), "stop everything please")).toBe(true);
  });

  it("prefix does NOT match mid-word — 'stop' must not fire on 'stopwatch'", () => {
    expect(ruleMatches(rule({ matchType: "prefix" }), "stopwatch reminder")).toBe(false);
  });

  it("contains matches anywhere", () => {
    expect(ruleMatches(rule({ matchType: "contains" }), "please stop now")).toBe(true);
  });

  it("contains matches mid-word too (by design)", () => {
    expect(ruleMatches(rule({ matchType: "contains" }), "stopwatch")).toBe(true);
  });

  it("a disabled rule never matches", () => {
    expect(ruleMatches(rule({ enabled: false }), "stop")).toBe(false);
  });

  it("a rule whose keyword normalises to nothing never matches", () => {
    expect(ruleMatches(rule({ keyword: "###" }), "stop")).toBe(false);
  });

  it("normalises the configured keyword too", () => {
    expect(ruleMatches(rule({ keyword: " Stop. " }), "stop")).toBe(true);
  });
});

describe("compareRules — precedence tiers", () => {
  it("1. a channel-specific rule beats a channel-agnostic one", () => {
    const specific = rule({ id: "b", channel: "sms" });
    const agnostic = rule({ id: "a", channel: null });
    expect([agnostic, specific].sort(compareRules)[0]?.id).toBe("b");
  });

  it("2. exact beats prefix beats contains", () => {
    const exact = rule({ id: "e", matchType: "exact" });
    const prefix = rule({ id: "p", matchType: "prefix" });
    const contains = rule({ id: "c", matchType: "contains" });
    expect([contains, prefix, exact].sort(compareRules).map((r) => r.id)).toEqual(["e", "p", "c"]);
  });

  it("3. lower explicit priority wins", () => {
    const high = rule({ id: "hi", priority: 1 });
    const low = rule({ id: "lo", priority: 900 });
    expect([low, high].sort(compareRules)[0]?.id).toBe("hi");
  });

  it("4. the longer keyword wins when priority ties", () => {
    const short = rule({ id: "s", keyword: "stop" });
    const long = rule({ id: "l", keyword: "stop all" });
    expect([short, long].sort(compareRules)[0]?.id).toBe("l");
  });

  it("5. rule id breaks a total tie — never a coin flip", () => {
    const a = rule({ id: "aaa" });
    const b = rule({ id: "bbb" });
    expect([b, a].sort(compareRules)[0]?.id).toBe("aaa");
    expect([a, b].sort(compareRules)[0]?.id).toBe("aaa");
  });

  it("channel specificity outranks match type", () => {
    const smsContains = rule({ id: "sms", channel: "sms", matchType: "contains" });
    const anyExact = rule({ id: "any", channel: null, matchType: "exact" });
    expect([anyExact, smsContains].sort(compareRules)[0]?.id).toBe("sms");
  });

  it("match type outranks explicit priority", () => {
    const exactLowPrio = rule({ id: "exact", matchType: "exact", priority: 9000 });
    const containsHighPrio = rule({ id: "contains", matchType: "contains", priority: 1 });
    expect([containsHighPrio, exactLowPrio].sort(compareRules)[0]?.id).toBe("exact");
  });
});

describe("matchKeywordRule", () => {
  it("returns null for a message that normalises to nothing", () => {
    expect(matchKeywordRule([rule()], "!!!", "sms")).toBeNull();
  });

  it("returns null when no rule matches", () => {
    expect(matchKeywordRule([rule({ keyword: "HELP" })], "stop", "sms")).toBeNull();
  });

  it("returns null for an empty rule set", () => {
    expect(matchKeywordRule([], "stop", "sms")).toBeNull();
  });

  it("excludes rules configured for a different channel", () => {
    expect(matchKeywordRule([rule({ channel: "whatsapp" })], "stop", "sms")).toBeNull();
  });

  it("includes channel-agnostic rules", () => {
    expect(matchKeywordRule([rule({ channel: null })], "stop", "sms")?.rule.id).toBeDefined();
  });

  it("includes rules for the matching channel", () => {
    expect(matchKeywordRule([rule({ channel: "sms" })], "stop", "sms")?.rule.channel).toBe("sms");
  });

  it("returns the normalised message alongside the winner", () => {
    expect(matchKeywordRule([rule()], "  Stop! ", "sms")?.normalizedMessage).toBe("stop");
  });

  it("picks the single winner by precedence, not by array order", () => {
    const rules = [
      rule({ id: "agnostic-exact", channel: null, matchType: "exact" }),
      rule({ id: "sms-contains", channel: "sms", matchType: "contains" }),
    ];
    expect(matchKeywordRule(rules, "stop", "sms")?.rule.id).toBe("sms-contains");
  });

  it("skips disabled rules and falls through to the next candidate", () => {
    const rules = [
      rule({ id: "disabled", channel: "sms", enabled: false }),
      rule({ id: "enabled", channel: null }),
    ];
    expect(matchKeywordRule(rules, "stop", "sms")?.rule.id).toBe("enabled");
  });
});

describe("planAutoResponse", () => {
  it("no match → none", () => {
    expect(planAutoResponse(null)).toEqual({ kind: "none" });
  });

  it("body only → reply", () => {
    const match = matchKeywordRule([rule({ responseBody: "Bye", action: null })], "stop", "sms");
    expect(planAutoResponse(match)).toEqual({
      kind: "reply", ruleId: "11111111-1111-4000-8000-000000000001", body: "Bye",
    });
  });

  it("action only → action", () => {
    const match = matchKeywordRule([rule({ responseBody: null, action: "opt_out" })], "stop", "sms");
    expect(planAutoResponse(match)).toEqual({
      kind: "action", ruleId: "11111111-1111-4000-8000-000000000001", action: "opt_out",
    });
  });

  it("body and action → reply_and_action", () => {
    const match = matchKeywordRule([rule({ responseBody: "Bye", action: "opt_out" })], "stop", "sms");
    expect(planAutoResponse(match)).toEqual({
      kind: "reply_and_action", ruleId: "11111111-1111-4000-8000-000000000001",
      body: "Bye", action: "opt_out",
    });
  });

  it("a whitespace-only body counts as no body", () => {
    const match = matchKeywordRule([rule({ responseBody: "   ", action: "opt_out" })], "stop", "sms");
    expect(planAutoResponse(match).kind).toBe("action");
  });

  it("a whitespace-only action counts as no action", () => {
    const match = matchKeywordRule([rule({ responseBody: "Bye", action: "  " })], "stop", "sms");
    expect(planAutoResponse(match).kind).toBe("reply");
  });

  it("neither body nor action → none, so no empty auto-response is recorded", () => {
    const match = matchKeywordRule([rule({ responseBody: null, action: null })], "stop", "sms");
    expect(planAutoResponse(match)).toEqual({ kind: "none" });
  });
});
