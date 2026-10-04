import { describe, it, expect } from "vitest";
import { buildPtView, parsePtPayload, isOpenEnded, type PtApiVersion } from "./viewModel";

const slab = { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: null, appliesToGender: "all" as const };
const v = (effectiveFrom: string, status: PtApiVersion["status"], extra: Partial<PtApiVersion> = {}): PtApiVersion => ({
  stateCode: "MH", effectiveFrom, effectiveTo: null, status, legacy: false, reason: null, backDated: false, createdAt: null, slabs: [slab], ...extra,
});
const payload = {
  today: "2026-10-03", viewerId: "u-1", makerChecker: true, lastFinalisedMonth: "2026-08", earliestEffectiveFrom: "2026-09-01",
  pending: [
    { id: "r1", kind: "version", stateCode: "MH", effectiveFrom: "2027-04-01", slabs: [slab], reason: null, makerId: "u-2", createdAt: "2026-10-01T00:00:00Z" },
    { id: "r2", kind: "version", stateCode: "KA", effectiveFrom: "2027-04-01", slabs: [slab], reason: null, makerId: "u-2", createdAt: "2026-10-01T00:00:00Z" },
    { id: "r3", kind: "checker_off", stateCode: null, effectiveFrom: null, slabs: [], reason: "Single officer office", makerId: "u-1", createdAt: "2026-10-02T00:00:00Z" },
  ],
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

describe("pending requests (maker != checker)", () => {
  const parsed = parsePtPayload(payload)!;
  it("parses the switch, the viewer and the pending list; a malformed pending entry is a load error", () => {
    expect(parsed).toMatchObject({ makerChecker: true, viewerId: "u-1" });
    expect(parsed.pending.map((x) => x.id)).toEqual(["r1", "r2", "r3"]);
    expect(parsePtPayload({ ...payload, pending: [{ id: "x", kind: "nonsense", makerId: "u" }] })).toBeNull();
    expect(parsePtPayload({ ...payload, makerChecker: undefined })?.makerChecker).toBe(true); // default ON
  });
  it("scopes pending to the selected state plus the tenant-wide 'turn off' request", () => {
    expect(buildPtView(parsed, "MH", undefined).pending.map((x) => x.id)).toEqual(["r1", "r3"]);
    expect(buildPtView(parsed, "KA", undefined).pending.map((x) => x.id)).toEqual(["r2", "r3"]);
    expect(buildPtView(parsed, undefined, undefined)).toMatchObject({ hasPending: true });
    expect(buildPtView({ ...parsed, pending: [] }, "MH", undefined).hasPending).toBe(false);
  });
});

describe("isOpenEnded", () => {
  it("recognises the sentinel and missing bounds", () => {
    expect(isOpenEnded(999999999999)).toBe(true);
    expect(isOpenEnded(null)).toBe(true);
    expect(isOpenEnded(1500000)).toBe(false);
  });
});

describe("appliesToGender parsing", () => {
  it("defaults a missing or unknown gender to all and keeps female / male", () => {
    const raw = { ...payload, states: [{ stateCode: "MH", versions: [{ ...v("2025-04-01", "current"), slabs: [
      { fromMinor: 0, toMinor: 10, taxMinor: 0, februaryTaxMinor: null },
      { fromMinor: 0, toMinor: 10, taxMinor: 0, februaryTaxMinor: null, appliesToGender: "female" },
      { fromMinor: 0, toMinor: 10, taxMinor: 0, februaryTaxMinor: null, appliesToGender: "weird" },
    ] }] }] };
    expect(parsePtPayload(raw)!.states[0]!.versions[0]!.slabs.map((x) => x.appliesToGender)).toEqual(["all", "female", "all"]);
  });
});
