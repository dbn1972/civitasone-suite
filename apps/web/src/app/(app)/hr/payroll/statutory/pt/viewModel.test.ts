import { describe, it, expect } from "vitest";
import { buildPtView, parsePtPayload, isOpenEnded, type PtApiVersion } from "./viewModel";

const slab = { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: null };
const v = (effectiveFrom: string, status: PtApiVersion["status"], extra: Partial<PtApiVersion> = {}): PtApiVersion => ({
  stateCode: "MH", effectiveFrom, effectiveTo: null, status, legacy: false, reason: null, backDated: false, createdAt: null, slabs: [slab], ...extra,
});
const payload = {
  today: "2026-10-03", lastFinalisedMonth: "2026-08", earliestEffectiveFrom: "2026-09-01",
  states: [{ stateCode: "MH", versions: [v("1900-01-01", "past", { legacy: true }), v("2025-04-01", "current"), v("2027-04-01", "upcoming")] }],
};

describe("parsePtPayload", () => {
  it("accepts the API shape and rejects anything else (a load error, never an empty page)", () => {
    expect(parsePtPayload(payload)?.states[0]?.versions[1]?.effectiveFrom).toBe("2025-04-01");
    expect(parsePtPayload(null)).toBeNull();
    expect(parsePtPayload({ today: "x" })).toBeNull();
    expect(parsePtPayload({ today: "x", states: [{ stateCode: "MH", versions: [{ effectiveFrom: "2026-01-01", status: "weird", slabs: [] }] }] })).toBeNull();
  });
});

describe("buildPtView", () => {
  const parsed = parsePtPayload(payload)!;
  it("no state selected: nothing is selected, configured states are listed", () => {
    const view = buildPtView(parsed, undefined, undefined);
    expect(view).toMatchObject({ stateCode: null, hasVersions: false, selected: null, configuredStates: ["MH"], hasConfiguredStates: true });
  });
  it("selects the current version by default, newest first, and bases the form on it", () => {
    const view = buildPtView(parsed, "mh", undefined);
    expect(view.versions.map((x) => x.effectiveFrom)).toEqual(["2027-04-01", "2025-04-01", "1900-01-01"]);
    expect(view.current?.effectiveFrom).toBe("2025-04-01");
    expect(view.selected?.effectiveFrom).toBe("2025-04-01");
    expect(view.baseSlabs).toEqual([slab]);
  });
  it("?version= views a past version; an unknown one falls back to the current", () => {
    expect(buildPtView(parsed, "MH", "1900-01-01").selected?.legacy).toBe(true);
    expect(buildPtView(parsed, "MH", "1999-09-09").selected?.effectiveFrom).toBe("2025-04-01");
  });
  it("a state with no versions yields an empty timeline and a blank form base", () => {
    const view = buildPtView(parsed, "KA", undefined);
    expect(view).toMatchObject({ stateCode: "KA", hasVersions: false, selected: null, current: null, baseSlabs: [] });
  });
});

describe("isOpenEnded", () => {
  it("recognises the sentinel and missing bounds", () => {
    expect(isOpenEnded(999999999999)).toBe(true);
    expect(isOpenEnded(null)).toBe(true);
    expect(isOpenEnded(1500000)).toBe(false);
  });
});
