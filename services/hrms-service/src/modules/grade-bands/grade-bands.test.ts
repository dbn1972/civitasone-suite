/**
 * S8-G4 -- pure unit tests: rank resolution, request validation, and the proof that the WFH comparison is
 * unchanged for a government tenant whether or not the band arguments are passed.
 */
import { describe, it, expect } from "vitest";
import { effectiveRank, normaliseCpcLevel } from "./rank.js";
import { createGradeBandBody, updateGradeBandBody } from "./validators.js";
import { isGazettedForWfh, normalisePayLevel } from "../attendance/wfh-eligibility.js";
import { resolvePolicy } from "../policy-settings/registry.js";

const band = { id: "b1", code: "M2", name: "Manager 2", rank: 40 };

describe("effectiveRank", () => {
  it("government scale: rank is the CPC level 1-18, exactly what consumers read before", () => {
    for (const level of [1, 5, 9, 10, 18]) {
      expect(effectiveRank("cpc7", level, null)).toEqual({ scale: "cpc7", rank: level, source: "level", payLevel: level, band: null });
    }
  });
  it("government scale ignores a band even if one is linked", () => {
    expect(effectiveRank("cpc7", 7, band).rank).toBe(7);
    expect(effectiveRank("cpc7", 7, band).band).toBeNull();
  });
  it("government scale: 0, null, 19, 40 and fractions are unclassified (null), never guessed", () => {
    for (const level of [0, null, undefined, 19, 40, -1, 3.5]) expect(effectiveRank("cpc7", level as never, null).rank).toBeNull();
  });
  it("band scale: rank is the band rank; a stale level is NOT used as a fallback", () => {
    expect(effectiveRank("private_bands", 12, band)).toMatchObject({ rank: 40, source: "band", payLevel: 12 });
    expect(effectiveRank("private_bands", 12, null)).toMatchObject({ rank: null, source: null, payLevel: 12 });
    expect(effectiveRank("private_bands", 40, null).rank).toBeNull();
  });
  it("normaliseCpcLevel matches the WFH module's own normaliser", () => {
    for (const v of [0, 1, 18, 19, null, undefined, 2.5, -3]) expect(normaliseCpcLevel(v as never)).toBe(normalisePayLevel(v as never));
  });
});

describe("pay_scale / wfh_eligibility policy defaults", () => {
  it("pay_scale defaults to cpc7 (no stored row == government behaviour)", () => {
    expect(resolvePolicy("pay_scale", undefined)).toEqual({ kind: "cpc7" });
    expect(resolvePolicy("pay_scale", {})).toEqual({ kind: "cpc7" });
    expect(resolvePolicy("pay_scale", { kind: "garbage" })).toEqual({ kind: "cpc7" });
    expect(resolvePolicy("pay_scale", { kind: "private_bands" })).toEqual({ kind: "private_bands" });
  });
  it("wfh_eligibility keeps its old defaults and gains maxBandRank = null", () => {
    expect(resolvePolicy("wfh_eligibility", undefined)).toEqual({ enforceGazettedExclusion: true, maxPayLevel: 9, maxBandRank: null });
    expect(resolvePolicy("wfh_eligibility", { enforceGazettedExclusion: true, maxPayLevel: 12 })).toMatchObject({ maxPayLevel: 12, maxBandRank: null });
  });
});

describe("isGazettedForWfh parity", () => {
  const policy = resolvePolicy("wfh_eligibility", undefined);
  it("government: identical result with no band argument, a cpc7 band argument, and a band rank that must be ignored", () => {
    for (let level = 0; level <= 18; level++) {
      const lv = normalisePayLevel(level);
      const legacy = lv !== null && lv > 9;
      expect(isGazettedForWfh(lv, policy)).toBe(legacy);
      expect(isGazettedForWfh(lv, policy, { scale: "cpc7", bandRank: null })).toBe(legacy);
      expect(isGazettedForWfh(lv, policy, { scale: "cpc7", bandRank: 9999 })).toBe(legacy);
    }
  });
  it("government: the switch-off still wins and null still means not excluded", () => {
    expect(isGazettedForWfh(15, { ...policy, enforceGazettedExclusion: false })).toBe(false);
    expect(isGazettedForWfh(null, policy)).toBe(false);
  });
  it("band tenant: compares band rank with maxBandRank; default null excludes nobody; unclassified never denied", () => {
    expect(isGazettedForWfh(12, policy, { scale: "private_bands", bandRank: 40 })).toBe(false);
    const p = { ...policy, maxBandRank: 30 };
    expect(isGazettedForWfh(null, p, { scale: "private_bands", bandRank: 40 })).toBe(true);
    expect(isGazettedForWfh(null, p, { scale: "private_bands", bandRank: 30 })).toBe(false);
    expect(isGazettedForWfh(18, p, { scale: "private_bands", bandRank: null })).toBe(false);
    expect(isGazettedForWfh(18, { ...p, enforceGazettedExclusion: false }, { scale: "private_bands", bandRank: 99 })).toBe(false);
  });
  it("a policy object from an older caller without maxBandRank behaves like null", () => {
    const old = { enforceGazettedExclusion: true, maxPayLevel: 9 } as never;
    expect(isGazettedForWfh(null, old, { scale: "private_bands", bandRank: 500 })).toBe(false);
  });
});

describe("grade band request validation", () => {
  const ok = { code: " c2 ", name: "Consultant 2", rank: 20 };
  it("trims and upper-cases the code; money becomes bigint from a number or a digit string", () => {
    const b = createGradeBandBody.parse({ ...ok, ctcMinMinor: 100, ctcMaxMinor: "999999999999999" });
    expect(b.code).toBe("C2");
    expect(b.ctcMinMinor).toBe(100n);
    expect(b.ctcMaxMinor).toBe(999999999999999n);
  });
  it("rejects bad codes, ranks, notice days, 16-digit money and unknown fields", () => {
    for (const bad of [
      { ...ok, code: "" }, { ...ok, code: "a b" }, { ...ok, code: "x".repeat(17) }, { ...ok, code: "-lead" },
      { ...ok, rank: 0 }, { ...ok, rank: 10000 }, { ...ok, rank: 1.5 },
      { ...ok, noticeDays: 366 }, { ...ok, noticeDays: -1 },
      { ...ok, ctcMinMinor: "1234567890123456" }, { ...ok, ctcMinMinor: "12.5" }, { ...ok, ctcMinMinor: -5 },
      { ...ok, ctcMinMinor: 10, ctcMaxMinor: 5 },
      { ...ok, extra: 1 },
    ]) expect(createGradeBandBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("allows equal min and max and nulls", () => {
    expect(createGradeBandBody.safeParse({ ...ok, ctcMinMinor: 5, ctcMaxMinor: 5 }).success).toBe(true);
    expect(createGradeBandBody.safeParse({ ...ok, track: null, noticeDays: null, ctcMinMinor: null }).success).toBe(true);
  });
  it("update: nothing-to-update and a code change are refused; expectedVersion alone is not a change", () => {
    expect(updateGradeBandBody.safeParse({}).success).toBe(false);
    expect(updateGradeBandBody.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(updateGradeBandBody.safeParse({ code: "NEW" }).success).toBe(false);
    expect(updateGradeBandBody.safeParse({ name: "Renamed", expectedVersion: 2 }).success).toBe(true);
  });
});
