/**
 * CR-MKT-05 — A/B allocation, variant validation, result summarisation, the
 * "clear leader" winner rule and the click heatmap. Pure domain.
 *
 * The allocation split is the part that must not drift: a recipient who flipped
 * variants between the send and the follow-up corrupts the result, so
 * determinism is asserted directly rather than inferred.
 */
import { describe, it, expect } from "vitest";
import {
  validateVariants,
  allocateVariant,
  bucketOf,
  summariseVariants,
  determineWinner,
  buildHeatmap,
  MIN_SAMPLE_PER_VARIANT,
  MIN_MARGIN_PCT,
  type VariantDef,
  type EngagementEvent,
} from "../src/modules/experiments/domain.js";

const A: VariantDef = { id: "11111111-1111-4000-8000-000000000001", key: "a", allocationPct: 50 };
const B: VariantDef = { id: "22222222-2222-4000-8000-000000000002", key: "b", allocationPct: 50 };

describe("validateVariants", () => {
  it("accepts a valid 50/50 split", () => {
    expect(validateVariants([A, B])).toBeNull();
  });

  it("accepts an uneven split that still sums to 100", () => {
    expect(validateVariants([{ ...A, allocationPct: 90 }, { ...B, allocationPct: 10 }])).toBeNull();
  });

  it("accepts three variants summing to 100", () => {
    expect(validateVariants([
      { ...A, allocationPct: 34 },
      { ...B, allocationPct: 33 },
      { id: "c", key: "c", allocationPct: 33 },
    ])).toBeNull();
  });

  it("rejects an empty variant set", () => {
    expect(validateVariants([])).toEqual({
      code: "NO_VARIANTS", message: "an experiment needs at least 2 variants",
    });
  });

  it("rejects a single variant — there is nothing to compare against", () => {
    expect(validateVariants([{ ...A, allocationPct: 100 }])?.code).toBe("NO_VARIANTS");
  });

  it("rejects duplicate keys, case- and whitespace-insensitively", () => {
    const err = validateVariants([A, { ...B, key: " A " }]);
    expect(err?.code).toBe("DUPLICATE_KEY");
    expect(err?.message).toContain("duplicate variant key");
  });

  it("rejects a zero allocation", () => {
    expect(validateVariants([{ ...A, allocationPct: 0 }, { ...B, allocationPct: 100 }])?.code)
      .toBe("NON_POSITIVE_ALLOCATION");
  });

  it("rejects a negative allocation", () => {
    expect(validateVariants([{ ...A, allocationPct: -10 }, { ...B, allocationPct: 110 }])?.code)
      .toBe("NON_POSITIVE_ALLOCATION");
  });

  it("rejects a fractional allocation", () => {
    expect(validateVariants([{ ...A, allocationPct: 50.5 }, { ...B, allocationPct: 49.5 }])?.code)
      .toBe("NON_POSITIVE_ALLOCATION");
  });

  it("rejects allocations summing to less than 100 — recipients would be unassigned", () => {
    const err = validateVariants([{ ...A, allocationPct: 40 }, { ...B, allocationPct: 40 }]);
    expect(err?.code).toBe("ALLOCATION_NOT_100");
    expect(err?.message).toContain("got 80");
  });

  it("rejects allocations summing to more than 100", () => {
    expect(validateVariants([{ ...A, allocationPct: 70 }, { ...B, allocationPct: 70 }])?.code)
      .toBe("ALLOCATION_NOT_100");
  });
});

describe("bucketOf", () => {
  it("is deterministic for the same experiment + subject", () => {
    const first = bucketOf("exp-1", "subject-1");
    for (let i = 0; i < 5; i++) expect(bucketOf("exp-1", "subject-1")).toBe(first);
  });

  it("always lands in 0..99", () => {
    for (let i = 0; i < 500; i++) {
      const b = bucketOf("exp-1", `subject-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("differs across experiments for the same subject (no cross-test correlation)", () => {
    const buckets = new Set([1, 2, 3, 4, 5].map((n) => bucketOf(`exp-${n}`, "same-subject")));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe("allocateVariant", () => {
  it("returns null for an empty variant set", () => {
    expect(allocateVariant("exp-1", "s1", [])).toBeNull();
  });

  it("is stable across repeated calls", () => {
    const first = allocateVariant("exp-1", "subject-42", [A, B]);
    for (let i = 0; i < 10; i++) {
      expect(allocateVariant("exp-1", "subject-42", [A, B])?.id).toBe(first?.id);
    }
  });

  it("is independent of the order the variants are supplied in", () => {
    for (let i = 0; i < 50; i++) {
      const s = `subject-${i}`;
      expect(allocateVariant("exp-1", s, [A, B])?.key).toBe(allocateVariant("exp-1", s, [B, A])?.key);
    }
  });

  it("sends everyone to the only 100% variant", () => {
    const solo: VariantDef = { ...A, allocationPct: 100 };
    for (let i = 0; i < 50; i++) {
      expect(allocateVariant("exp-1", `s-${i}`, [solo])?.key).toBe("a");
    }
  });

  it("splits roughly in line with the allocation over a large sample", () => {
    let a = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (allocateVariant("exp-split", `subject-${i}`, [A, B])?.key === "a") a++;
    }
    // 50/50 with a SHA-256 bucket: a ±5pp tolerance is generous but still
    // catches an allocation that ignores allocationPct entirely.
    expect(a / n).toBeGreaterThan(0.45);
    expect(a / n).toBeLessThan(0.55);
  });

  it("honours a 90/10 skew", () => {
    let a = 0;
    const n = 4000;
    const skewA: VariantDef = { ...A, allocationPct: 90 };
    const skewB: VariantDef = { ...B, allocationPct: 10 };
    for (let i = 0; i < n; i++) {
      if (allocateVariant("exp-skew", `subject-${i}`, [skewA, skewB])?.key === "a") a++;
    }
    expect(a / n).toBeGreaterThan(0.85);
    expect(a / n).toBeLessThan(0.95);
  });

  it("falls back to the last variant when allocations sum below 100", () => {
    // Defensive branch: a recipient must never drop out of the experiment.
    const under: VariantDef[] = [
      { ...A, allocationPct: 1 },
      { ...B, allocationPct: 1 },
    ];
    for (let i = 0; i < 200; i++) {
      expect(allocateVariant("exp-under", `s-${i}`, under)).not.toBeNull();
    }
  });
});

describe("summariseVariants", () => {
  it("counts opens and clicks per variant and computes 4dp rates", () => {
    const events: EngagementEvent[] = [
      { variantId: A.id, eventType: "open" },
      { variantId: A.id, eventType: "open" },
      { variantId: A.id, eventType: "click", linkPosition: 1 },
      { variantId: B.id, eventType: "open" },
    ];
    const results = summariseVariants([A, B], { [A.id]: 8, [B.id]: 4 }, events);
    expect(results[0]).toEqual({
      variantId: A.id, key: "a", sent: 8, opens: 2, clicks: 1, openRate: 0.25, clickRate: 0.125,
    });
    expect(results[1]?.openRate).toBe(0.25);
    expect(results[1]?.clickRate).toBe(0);
  });

  it("reports zero rates when nothing was sent — never divides by zero", () => {
    const results = summariseVariants([A], {}, [{ variantId: A.id, eventType: "click", linkPosition: 2 }]);
    expect(results[0]?.sent).toBe(0);
    expect(results[0]?.openRate).toBe(0);
    expect(results[0]?.clickRate).toBe(0);
  });

  it("ignores events belonging to other variants", () => {
    const results = summariseVariants([A], { [A.id]: 10 }, [{ variantId: "other", eventType: "open" }]);
    expect(results[0]?.opens).toBe(0);
  });

  it("rounds rates to 4 decimal places", () => {
    const results = summariseVariants([A], { [A.id]: 3 }, [{ variantId: A.id, eventType: "open" }]);
    expect(results[0]?.openRate).toBe(0.3333);
  });
});

describe("determineWinner — a deterministic clear-leader rule, NOT significance", () => {
  const results = (aClicks: number, bClicks: number, sent = MIN_SAMPLE_PER_VARIANT) =>
    summariseVariants(
      [A, B],
      { [A.id]: sent, [B.id]: sent },
      [
        ...Array.from({ length: aClicks }, () => ({ variantId: A.id, eventType: "click" as const, linkPosition: 1 })),
        ...Array.from({ length: bClicks }, () => ({ variantId: B.id, eventType: "click" as const, linkPosition: 1 })),
      ],
    );

  it("refuses to decide with fewer than 2 variants", () => {
    expect(determineWinner(summariseVariants([A], { [A.id]: 1000 }, []))).toEqual({
      decided: false, reason: "insufficient_sample", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT,
    });
  });

  it("refuses to decide when any variant is below the minimum sample", () => {
    expect(determineWinner(results(50, 1, MIN_SAMPLE_PER_VARIANT - 1)).decided).toBe(false);
  });

  it("decides at exactly the minimum sample when the margin is clear", () => {
    const verdict = determineWinner(results(20, 5));
    expect(verdict).toEqual({ decided: true, variantId: A.id, key: "a", marginPct: 15 });
  });

  it("refuses when the margin is below the minimum (no separation)", () => {
    // 1pp gap at n=100 → below MIN_MARGIN_PCT of 2.
    const verdict = determineWinner(results(11, 10));
    expect(verdict).toEqual({
      decided: false, reason: "no_separation", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT,
    });
  });

  it("decides at exactly the minimum margin", () => {
    const verdict = determineWinner(results(12, 10));
    expect(verdict.decided).toBe(true);
    if (verdict.decided) expect(verdict.marginPct).toBe(MIN_MARGIN_PCT);
  });

  it("never breaks an exact tie — a coin flip dressed as a result is worse than none", () => {
    expect(determineWinner(results(10, 10))).toEqual({
      decided: false, reason: "no_separation", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT,
    });
  });

  it("picks the higher click rate regardless of input order", () => {
    const r = results(5, 30);
    expect(determineWinner(r).decided).toBe(true);
    const verdict = determineWinner([...r].reverse());
    expect(verdict.decided && verdict.key).toBe("b");
  });

  it("refuses to decide on an empty result set", () => {
    expect(determineWinner([]).decided).toBe(false);
  });
});

describe("buildHeatmap", () => {
  const events: EngagementEvent[] = [
    { variantId: A.id, eventType: "click", linkPosition: 1 },
    { variantId: A.id, eventType: "click", linkPosition: 1 },
    { variantId: A.id, eventType: "click", linkPosition: 3 },
    { variantId: B.id, eventType: "click", linkPosition: 2 },
    { variantId: A.id, eventType: "open" },
    { variantId: A.id, eventType: "click", linkPosition: null },
  ];

  it("aggregates clicks per position, ordered by position", () => {
    expect(buildHeatmap(events)).toEqual([
      { linkPosition: 1, clicks: 2, sharePct: 50 },
      { linkPosition: 2, clicks: 1, sharePct: 25 },
      { linkPosition: 3, clicks: 1, sharePct: 25 },
    ]);
  });

  it("filters to a single variant when asked", () => {
    expect(buildHeatmap(events, B.id)).toEqual([{ linkPosition: 2, clicks: 1, sharePct: 100 }]);
  });

  it("excludes opens — they carry no positional information", () => {
    expect(buildHeatmap([{ variantId: A.id, eventType: "open", linkPosition: 1 }])).toEqual([]);
  });

  it("excludes clicks with no position", () => {
    expect(buildHeatmap([{ variantId: A.id, eventType: "click" }])).toEqual([]);
  });

  it("excludes a non-positive position", () => {
    expect(buildHeatmap([{ variantId: A.id, eventType: "click", linkPosition: 0 }])).toEqual([]);
  });

  it("returns an empty heatmap for no events", () => {
    expect(buildHeatmap([])).toEqual([]);
  });

  it("returns an empty heatmap for an unknown variant filter", () => {
    expect(buildHeatmap(events, "no-such-variant")).toEqual([]);
  });

  it("rounds sharePct to 2dp", () => {
    const three: EngagementEvent[] = [
      { variantId: A.id, eventType: "click", linkPosition: 1 },
      { variantId: A.id, eventType: "click", linkPosition: 2 },
      { variantId: A.id, eventType: "click", linkPosition: 3 },
    ];
    expect(buildHeatmap(three).map((c) => c.sharePct)).toEqual([33.33, 33.33, 33.33]);
  });
});
