import { describe, it, expect } from "vitest";
import {
  PT_ANNUAL_CAP_MINOR, computePtMonthMinor, periodEndOf, dayAfter, dayBefore, todayIst,
  findSlabSetProblem, checkNewVersion, buildTimeline, createPtVersionBody, ptGenderUnresolved, normalisePtGender, type PtSlab,
} from "../src/modules/payroll/pt-versions-domain.js";

const flat = (amount: bigint, februaryAmount: bigint | null = null): PtSlab[] => [{ from: 0n, to: 999_999_999_999n, amount, februaryAmount }];

describe("computePtMonthMinor", () => {
  it("is the plain slab lookup when there is no February amount and the year is under the cap", () => {
    const slabs: PtSlab[] = [
      { from: 0n, to: 1_500_000n, amount: 0n, februaryAmount: null },
      { from: 1_500_001n, to: 999_999_999_999n, amount: 20_000n, februaryAmount: null },
    ];
    expect(computePtMonthMinor(slabs, 1_500_000n, "2026-07", 0n)).toBe(0n);
    expect(computePtMonthMinor(slabs, 1_500_001n, "2026-07", 0n)).toBe(20_000n);
    expect(computePtMonthMinor(slabs, 3_000_000n, "2027-02", 0n)).toBe(20_000n);
    expect(computePtMonthMinor([], 3_000_000n, "2026-07", 0n)).toBe(0n);
  });

  it("uses the February amount in February only", () => {
    const slabs = flat(20_000n, 30_000n);
    expect(computePtMonthMinor(slabs, 100n, "2027-02", 0n)).toBe(30_000n);
    expect(computePtMonthMinor(slabs, 100n, "2027-01", 0n)).toBe(20_000n);
    expect(computePtMonthMinor(slabs, 100n, "2027-03", 0n)).toBe(20_000n);
  });

  it("a state's 11 x monthly + February reaching exactly Rs 2,500 is not clamped", () => {
    // Rs 200 x 11 + Rs 300 = Rs 2,500
    expect(computePtMonthMinor(flat(20_000n, 30_000n), 100n, "2027-02", 220_000n)).toBe(30_000n);
  });

  it("clamps to what is left of the Article 276(2) cap, then to zero", () => {
    expect(PT_ANNUAL_CAP_MINOR).toBe(250_000n);
    expect(computePtMonthMinor(flat(30_000n), 100n, "2026-12", 240_000n)).toBe(10_000n);
    expect(computePtMonthMinor(flat(30_000n), 100n, "2027-01", 250_000n)).toBe(0n);
    expect(computePtMonthMinor(flat(30_000n), 100n, "2027-01", 300_000n)).toBe(0n);
    expect(computePtMonthMinor(flat(30_000n, 90_000n), 100n, "2027-02", 200_000n)).toBe(50_000n);
  });
});

describe("dates", () => {
  it("period end, day before and day after", () => {
    expect(periodEndOf("2026-02")).toBe("2026-02-28");
    expect(periodEndOf("2028-02")).toBe("2028-02-29");
    expect(periodEndOf("2026-12")).toBe("2026-12-31");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
    expect(todayIst(new Date("2026-10-03T20:00:00Z"))).toBe("2026-10-04"); // already the 4th in IST
  });
});

describe("findSlabSetProblem", () => {
  it("flags overlaps and duplicate starts, accepts adjacent and gapped sets", () => {
    expect(findSlabSetProblem([{ fromMinor: 0, toMinor: 10 }, { fromMinor: 5, toMinor: 20 }])).toMatch(/overlaps/);
    expect(findSlabSetProblem([{ fromMinor: 0, toMinor: 10 }, { fromMinor: 0, toMinor: 20 }])).toMatch(/start at 0/);
    expect(findSlabSetProblem([{ fromMinor: 0, toMinor: 10 }, { fromMinor: 11, toMinor: 20 }])).toBeNull();
    expect(findSlabSetProblem([{ fromMinor: 0, toMinor: 10 }, { fromMinor: 50, toMinor: 60 }])).toBeNull();
    expect(findSlabSetProblem([{ fromMinor: 11, toMinor: 20 }, { fromMinor: 0, toMinor: 10 }])).toBeNull();
  });
});

describe("createPtVersionBody", () => {
  const ok = { stateCode: "mh", effectiveFrom: "2027-04-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 20000, februaryTaxMinor: 30000 }] };
  it("normalises the state and accepts a February amount", () => {
    expect(createPtVersionBody.parse(ok).stateCode).toBe("MH");
  });
  it("rejects a single month above the annual cap, inverted ranges, impossible dates and empty sets", () => {
    expect(createPtVersionBody.safeParse({ ...ok, slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 250_001 }] }).success).toBe(false);
    expect(createPtVersionBody.safeParse({ ...ok, slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 1, februaryTaxMinor: 250_001 }] }).success).toBe(false);
    expect(createPtVersionBody.safeParse({ ...ok, slabs: [{ fromMinor: 100, toMinor: 5, taxMinor: 1 }] }).success).toBe(false);
    expect(createPtVersionBody.safeParse({ ...ok, effectiveFrom: "2027-02-30" }).success).toBe(false);
    expect(createPtVersionBody.safeParse({ ...ok, slabs: [] }).success).toBe(false);
  });
});

describe("checkNewVersion", () => {
  const base = { today: "2026-10-03", latestFinalisedMonth: null as string | null, existingEffectiveFroms: ["1900-01-01"], reason: undefined as string | undefined };
  it("allows a future date without a reason", () => {
    expect(checkNewVersion({ ...base, effectiveFrom: "2026-11-01" })).toEqual({ ok: true, backDated: false });
    expect(checkNewVersion({ ...base, effectiveFrom: "2026-10-03" })).toEqual({ ok: true, backDated: false });
  });
  it("refuses a duplicate date", () => {
    expect(checkNewVersion({ ...base, effectiveFrom: "1900-01-01" })).toMatchObject({ ok: false, failure: { code: "PT_VERSION_EXISTS" } });
  });
  it("needs a reason (10+ chars) when back-dated", () => {
    expect(checkNewVersion({ ...base, effectiveFrom: "2026-09-01" })).toMatchObject({ ok: false, failure: { code: "PT_BACKDATE_REASON_REQUIRED" } });
    expect(checkNewVersion({ ...base, effectiveFrom: "2026-09-01", reason: "short" })).toMatchObject({ ok: false });
    expect(checkNewVersion({ ...base, effectiveFrom: "2026-09-01", reason: "Notified late by the State" })).toEqual({ ok: true, backDated: true });
  });
  it("refuses any date up to the end of the latest finalised run's month", () => {
    const f = { ...base, latestFinalisedMonth: "2026-08", reason: "Correcting an earlier period" };
    expect(checkNewVersion({ ...f, effectiveFrom: "2026-08-31" })).toMatchObject({ ok: false, failure: { code: "PT_BACKDATE_BEFORE_FINALISED_RUN" } });
    expect(checkNewVersion({ ...f, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: false, failure: { code: "PT_BACKDATE_BEFORE_FINALISED_RUN" } });
    expect(checkNewVersion({ ...f, effectiveFrom: "2026-09-01" })).toEqual({ ok: true, backDated: true });
  });
});

describe("buildTimeline", () => {
  it("each version runs until the day before the next; status is relative to today", () => {
    const t = buildTimeline([
      { effectiveFrom: "2027-04-01", legacy: false },
      { effectiveFrom: "1900-01-01", legacy: true },
      { effectiveFrom: "2025-04-01", legacy: false },
    ], "2026-10-03");
    expect(t.map((v) => [v.effectiveFrom, v.effectiveTo, v.status])).toEqual([
      ["1900-01-01", "2025-03-31", "past"],
      ["2025-04-01", "2027-03-31", "current"],
      ["2027-04-01", null, "upcoming"],
    ]);
  });
  it("a lone version is current and open-ended", () => {
    expect(buildTimeline([{ effectiveFrom: "1900-01-01", legacy: true }], "2026-10-03")).toEqual([
      { effectiveFrom: "1900-01-01", legacy: true, effectiveTo: null, status: "current" },
    ]);
  });
});

describe("gender-specific slabs", () => {
  const slabs: PtSlab[] = [
    { from: 0n, to: 2_500_000n, amount: 0n, februaryAmount: null, gender: "female" },
    { from: 0n, to: 1_000_000n, amount: 0n, februaryAmount: null, gender: "all" },
    { from: 1_000_001n, to: 999_999_999_999n, amount: 20_000n, februaryAmount: 30_000n, gender: "all" },
  ];

  it("a slab of the employee's own gender wins over an 'all' slab", () => {
    expect(computePtMonthMinor(slabs, 2_000_000n, "2026-07", 0n, "female")).toBe(0n);
    expect(computePtMonthMinor(slabs, 2_000_000n, "2026-07", 0n, "male")).toBe(20_000n);
    expect(computePtMonthMinor(slabs, 2_000_000n, "2026-07", 0n, "Female")).toBe(0n);
  });

  it("falls back to an 'all' slab where the gender group has none for that income", () => {
    expect(computePtMonthMinor(slabs, 3_000_000n, "2026-07", 0n, "female")).toBe(20_000n);
  });

  it("missing / unknown gender uses 'all' slabs only", () => {
    for (const g of [undefined, null, "", "other", "x"]) {
      expect(computePtMonthMinor(slabs, 2_000_000n, "2026-07", 0n, g)).toBe(20_000n);
    }
    // a female-only slab never applies to an unknown-gender employee
    expect(computePtMonthMinor([slabs[0]!], 100n, "2026-07", 0n, null)).toBe(0n);
    expect(computePtMonthMinor([{ ...slabs[0]!, amount: 5_000n }], 100n, "2026-07", 0n, null)).toBe(0n);
  });

  it("slabs without a gender behave as 'all' (existing rows / callers)", () => {
    expect(computePtMonthMinor(flat(20_000n), 100n, "2026-07", 0n, "female")).toBe(20_000n);
  });

  it("the February amount and the Article 276(2) cap still apply to a gender slab", () => {
    const f: PtSlab[] = [{ from: 0n, to: 999_999_999_999n, amount: 20_000n, februaryAmount: 30_000n, gender: "female" }];
    expect(computePtMonthMinor(f, 100n, "2027-02", 0n, "female")).toBe(30_000n);
    expect(computePtMonthMinor(f, 100n, "2027-01", 0n, "female")).toBe(20_000n);
    expect(computePtMonthMinor(f, 100n, "2027-02", 245_000n, "female")).toBe(5_000n);
  });

  it("normalisePtGender / ptGenderUnresolved", () => {
    expect(normalisePtGender(" MALE ")).toBe("male");
    expect(normalisePtGender("other")).toBeNull();
    expect(ptGenderUnresolved(slabs, null)).toBe(true);
    expect(ptGenderUnresolved(slabs, "other")).toBe(true);
    expect(ptGenderUnresolved(slabs, "female")).toBe(false);
    expect(ptGenderUnresolved(flat(100n), null)).toBe(false); // no gender-specific slab: nothing to warn about
  });

  it("overlap is validated per gender group", () => {
    const r = (fromMinor: number, toMinor: number, appliesToGender?: "all" | "female" | "male") => ({ fromMinor, toMinor, ...(appliesToGender ? { appliesToGender } : {}) });
    // the same range in different groups is fine
    expect(findSlabSetProblem([r(0, 100, "all"), r(0, 100, "female"), r(0, 100, "male")])).toBeNull();
    expect(findSlabSetProblem([r(0, 100), r(101, 200, "female"), r(50, 150, "female")])).toMatch(/overlaps.*female/);
    expect(findSlabSetProblem([r(0, 100, "male"), r(100, 200, "male")])).toMatch(/male/);
    expect(findSlabSetProblem([r(0, 100), r(50, 150, "all")])).toMatch(/overlaps/);
    expect(findSlabSetProblem([r(0, 100, "female"), r(0, 50, "female")])).toMatch(/two slabs start at 0 \(female/);
  });

  it("the create body defaults appliesToGender to 'all' and rejects other values", () => {
    const base = { stateCode: "MH", effectiveFrom: "2099-01-01", slabs: [{ fromMinor: 0, toMinor: 10, taxMinor: 0 }] };
    expect(createPtVersionBody.parse(base).slabs[0]!.appliesToGender).toBe("all");
    expect(createPtVersionBody.parse({ ...base, slabs: [{ ...base.slabs[0]!, appliesToGender: "female" }] }).slabs[0]!.appliesToGender).toBe("female");
    expect(() => createPtVersionBody.parse({ ...base, slabs: [{ ...base.slabs[0]!, appliesToGender: "other" }] })).toThrow();
  });
});
