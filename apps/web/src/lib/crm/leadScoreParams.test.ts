import { describe, it, expect } from "vitest";
import {
  draftFromParams,
  draftIssues,
  emptyDraft,
  paramsFromDraft,
  paramsIssues,
  tierBoundKey,
  type ParamsDraft,
} from "./leadScoreParams";

/** Every case here mirrors what crm-service leads/score-rules-domain.ts buildScoreFn reads. */
const draft = (patch: Partial<ParamsDraft>): ParamsDraft => ({ ...emptyDraft(), ...patch });

describe("draft <-> params round trip (GAP-CRM-LEAD-SCORING-02)", () => {
  it("presence: blank boxes are omitted so the scorer defaults apply", () => {
    expect(paramsFromDraft("presence", emptyDraft())).toEqual({});
    expect(paramsFromDraft("presence", draft({ present: "70", absent: "0" }))).toEqual({ present: 70, absent: 0 });
  });

  it("map: rows become the values table and the default is kept", () => {
    const d = draft({ mapRows: [{ key: "referral", score: "90" }, { key: "website", score: "70" }], defaultScore: "20" });
    expect(paramsFromDraft("map", d)).toEqual({ values: { referral: 90, website: 70 }, default: 20 });
  });

  it("recency tiers use maxDays and numeric_threshold tiers use min", () => {
    const tiers = [{ bound: "7", score: "100" }];
    expect(tierBoundKey("recency")).toBe("maxDays");
    expect(tierBoundKey("numeric_threshold")).toBe("min");
    expect(paramsFromDraft("recency", draft({ tiers, beyondScore: "20", absentScore: "10" }))).toEqual({
      tiers: [{ maxDays: 7, score: 100 }], beyondScore: 20, absentScore: 10,
    });
    expect(paramsFromDraft("numeric_threshold", draft({ tiers, defaultScore: "0" }))).toEqual({
      tiers: [{ min: 7, score: 100 }], default: 0,
    });
  });

  it("a stored params object survives params -> draft -> params unchanged (incl. unmodelled keys)", () => {
    const cases: Array<["presence" | "map" | "recency" | "numeric_threshold", Record<string, unknown>]> = [
      ["presence", { present: 70, absent: 20 }],
      ["map", { values: { referral: 90, cold_call: 30 }, default: 20 }],
      ["recency", { tiers: [{ maxDays: 7, score: 100 }, { maxDays: 30, score: 60 }], beyondScore: 20, absentScore: 10 }],
      ["numeric_threshold", { tiers: [{ min: 100, score: 80 }], default: 0 }],
      ["presence", { present: 70, note: "keep me" }],
    ];
    for (const [type, params] of cases) {
      const d = draftFromParams(type, params);
      expect(d, JSON.stringify(params)).not.toBeNull();
      expect(paramsFromDraft(type, d!)).toEqual(params);
    }
  });

  it("returns null (stay in Advanced JSON) for params the form cannot represent without loss", () => {
    expect(draftFromParams("map", { values: [1, 2] })).toBeNull();
    expect(draftFromParams("map", { values: { a: "x" } })).toBeNull();
    expect(draftFromParams("presence", { present: "70" })).toBeNull();
    expect(draftFromParams("recency", { tiers: "soon" })).toBeNull();
    expect(draftFromParams("recency", { tiers: [{ min: 1, score: 1 }] })).toBeNull(); // wrong bound key for recency
    expect(draftFromParams("numeric_threshold", { tiers: [{ maxDays: 1, score: 1 }] })).toBeNull();
  });
});

describe("draftIssues: per-field validation of the form", () => {
  it("accepts blank optional fields and valid numbers", () => {
    expect(draftIssues("presence", emptyDraft())).toEqual([]);
    expect(draftIssues("presence", draft({ present: "100", absent: "0" }))).toEqual([]);
  });

  it("flags each bad score on its own field", () => {
    expect(draftIssues("presence", draft({ present: "150", absent: "abc" }))).toEqual([
      { field: "present", code: "scoreRange" },
      { field: "absent", code: "notNumber" },
    ]);
    expect(draftIssues("presence", draft({ present: "-1" }))).toEqual([{ field: "present", code: "scoreRange" }]);
  });

  it("map: blank, upper-case and duplicate keys, and a missing score, each point at their row", () => {
    const d = draft({ mapRows: [
      { key: "", score: "10" },
      { key: "Referral", score: "10" },
      { key: "web", score: "" },
      { key: "web", score: "10" },
    ] });
    expect(draftIssues("map", d)).toEqual([
      { field: "mapKey.0", code: "keyBlank" },
      { field: "mapKey.1", code: "keyCase" },
      { field: "mapScore.2", code: "notNumber" },
      { field: "mapKey.3", code: "keyDuplicate" },
    ]);
  });

  it("tiers: an unfinished row flags both boxes; recency days cannot be negative", () => {
    expect(draftIssues("numeric_threshold", draft({ tiers: [{ bound: "", score: "" }] }))).toEqual([
      { field: "tierBound.0", code: "notNumber" },
      { field: "tierScore.0", code: "notNumber" },
    ]);
    expect(draftIssues("recency", draft({ tiers: [{ bound: "-3", score: "50" }] }))).toEqual([{ field: "tierBound.0", code: "daysRange" }]);
    expect(draftIssues("numeric_threshold", draft({ tiers: [{ bound: "-3", score: "50" }] }))).toEqual([]); // a numeric minimum may be negative
  });
});

describe("paramsIssues: the Advanced JSON validator enforces the same contract", () => {
  it("keeps the shape errors the editor always had", () => {
    expect(paramsIssues("map", { values: [1, 2, 3] })).toEqual([{ field: "values", code: "valuesNotObject" }]);
    expect(paramsIssues("map", { values: { a: "x" } })).toEqual([{ field: "values.a", code: "valueNotNumber" }]);
    expect(paramsIssues("recency", { tiers: "x" })).toEqual([{ field: "tiers", code: "tiersNotArray" }]);
    expect(paramsIssues("recency", { tiers: [{ maxDays: 7 }] })).toEqual([{ field: "tiers.0", code: "tierShape" }]);
    expect(paramsIssues("presence", { present: "70" })).toEqual([{ field: "present", code: "notNumber" }]);
  });

  it("also rejects what the scorer would silently clamp or never match", () => {
    expect(paramsIssues("presence", { present: 150 })).toEqual([{ field: "present", code: "scoreRange" }]);
    expect(paramsIssues("map", { values: { Referral: 90 } })).toEqual([{ field: "values.Referral", code: "keyCase" }]);
    expect(paramsIssues("recency", { tiers: [{ maxDays: -1, score: 10 }] })).toEqual([{ field: "tiers.0.maxDays", code: "daysRange" }]);
  });

  it("passes the seeded default-rule params", () => {
    expect(paramsIssues("map", { values: { referral: 90, website: 70, campaign: 60, event: 50, cold_call: 30, social: 40 }, default: 20 })).toEqual([]);
    expect(paramsIssues("recency", { tiers: [{ maxDays: 7, score: 100 }, { maxDays: 14, score: 80 }], beyondScore: 20, absentScore: 10 })).toEqual([]);
    expect(paramsIssues("presence", { present: 70, absent: 20 })).toEqual([]);
    expect(paramsIssues("numeric_threshold", { tiers: [{ min: 100, score: 80 }], default: 0 })).toEqual([]);
  });
});
