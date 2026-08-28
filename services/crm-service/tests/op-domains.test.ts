/**
 * Pure-domain unit tests (no DB): stage-gate, stage-ageing, quotation-approval maths.
 */
import { describe, it, expect } from "vitest";
import { isPresent, missingMandatoryFields, findStage, skippedGateStage } from "../src/modules/deals/stage-gate.js";
import { daysInStage, evaluateAgeing } from "../src/modules/deals/stage-ageing.js";
import { breachesThreshold, initialStatus, breachSnapshot, effectiveDiscountBps } from "../src/modules/deals/quotation-approval-domain.js";

describe("stage-gate.isPresent", () => {
  it("treats null/undefined/empty-string/empty-array/zero as absent", () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent("")).toBe(false);
    expect(isPresent("   ")).toBe(false);
    expect(isPresent([])).toBe(false);
    expect(isPresent(0)).toBe(false);
    expect(isPresent(0n)).toBe(false);
  });
  it("treats non-empty values as present", () => {
    expect(isPresent("x")).toBe(true);
    expect(isPresent(["a"])).toBe(true);
    expect(isPresent(5)).toBe(true);
    expect(isPresent(5n)).toBe(true);
    expect(isPresent(true)).toBe(true);
  });
});

describe("stage-gate.missingMandatoryFields", () => {
  const stage = { id: "s1", name: "Negotiation", ordinal: 2, mandatoryFields: ["product", "quantity", "next_step"] };
  it("returns all unmet required fields", () => {
    const missing = missingMandatoryFields({ product: null, quantity: null, nextStep: null }, stage);
    expect(missing.sort()).toEqual(["next_step", "product", "quantity"]);
  });
  it("returns empty when all present (alias-mapped)", () => {
    const missing = missingMandatoryFields({ product: "Widget", quantity: 5, nextStep: "call" }, stage);
    expect(missing).toEqual([]);
  });
  it("no mandatory fields => nothing missing", () => {
    expect(missingMandatoryFields({}, { id: "s", name: "Lead", ordinal: 0 })).toEqual([]);
    expect(missingMandatoryFields({}, undefined)).toEqual([]);
  });
  it("unknown field name is reported as missing (fails loud)", () => {
    expect(missingMandatoryFields({}, { id: "s", name: "X", ordinal: 1, mandatoryFields: ["bogus_field"] })).toEqual(["bogus_field"]);
  });
  it("maps value alias to valueMinor", () => {
    expect(missingMandatoryFields({ valueMinor: null }, { id: "s", name: "X", ordinal: 1, mandatoryFields: ["value"] })).toEqual(["value"]);
    expect(missingMandatoryFields({ valueMinor: "100" }, { id: "s", name: "X", ordinal: 1, mandatoryFields: ["value"] })).toEqual([]);
  });
});

describe("stage-gate.findStage", () => {
  const stages = [
    { id: "a", name: "Lead", ordinal: 0 },
    { id: "b", name: "Won", ordinal: 1 },
  ];
  it("resolves by id when that's the only identifier supplied", () => {
    expect(findStage(stages, { stageId: "b" })?.name).toBe("Won");
  });
  it("falls back to name", () => {
    expect(findStage(stages, { stageName: "Lead" })?.id).toBe("a");
  });
  it("returns undefined for unknown / null stage list", () => {
    expect(findStage(stages, { stageName: "Nope" })).toBeUndefined();
    expect(findStage(null, { stageName: "Lead" })).toBeUndefined();
  });

  // Security regression (code review on PR #692): a stageId naming one stage combined
  // with a stage NAME naming a different one used to resolve to the id-matched stage,
  // letting gate/mandatory-field checks (evaluated against whatever findStage returns)
  // pass against the WRONG stage while the actual write — which always uses the raw
  // `stage` string, never `target.name` — landed on the stage the caller claimed by
  // name. Concretely: PATCH {stage:"Won", stageId:<Lead's own id>} on a deal currently
  // at Lead used to resolve `target` to Lead (id match wins) — a self-referential,
  // always-non-forward "move" that trivially passed skippedGateStage — while the row
  // was still written with stage="Won". Name must always win when both are supplied.
  it("a stageId belonging to a different stage does NOT override a supplied name", () => {
    const target = findStage(stages, { stageId: "a" /* Lead's id */, stageName: "Won" });
    expect(target?.name).toBe("Won");
    expect(target?.id).toBe("b");
  });
  it("full exploit replay: mismatched stageId no longer defeats the sequence gate", () => {
    const gated = [
      { id: "lead", name: "Lead", ordinal: 0 },
      { id: "prop", name: "Proposal", ordinal: 1, gate: true },
      { id: "neg", name: "Negotiation", ordinal: 2, gate: true },
      { id: "won", name: "Won", ordinal: 3 },
    ];
    // Attacker: deal is at Lead; request claims stage="Won" but reuses Lead's own id.
    const current = findStage(gated, { stageId: "lead", stageName: "Lead" });
    const target = findStage(gated, { stageId: "lead" /* attacker-supplied, wrong */, stageName: "Won" });
    expect(target?.name).toBe("Won"); // resolves to the REAL target, not Lead
    const skipped = skippedGateStage(gated, current, target);
    expect(skipped?.name).toBe("Proposal"); // gate now correctly fires
  });
});

describe("stage-ageing", () => {
  const now = new Date("2026-08-05T00:00:00Z");
  it("daysInStage floors elapsed days, never negative", () => {
    expect(daysInStage("2026-08-01T00:00:00Z", now)).toBe(4);
    expect(daysInStage("2026-08-04T12:00:00Z", now)).toBe(0);
    expect(daysInStage(null, now)).toBe(0);
    expect(daysInStage("2026-09-01T00:00:00Z", now)).toBe(0); // future -> 0
  });
  it("evaluateAgeing flags stalled only past the limit", () => {
    const r1 = evaluateAgeing({ stageEnteredAt: "2026-07-26T00:00:00Z", maxDays: 5, now });
    expect(r1.daysInStage).toBe(10);
    expect(r1.stalled).toBe(true);
    expect(r1.daysOverLimit).toBe(5);
    const r2 = evaluateAgeing({ stageEnteredAt: "2026-08-03T00:00:00Z", maxDays: 5, now });
    expect(r2.stalled).toBe(false);
    expect(r2.daysOverLimit).toBe(0);
  });
  it("no limit => never stalled", () => {
    const r = evaluateAgeing({ stageEnteredAt: "2020-01-01T00:00:00Z", maxDays: null, now });
    expect(r.stalled).toBe(false);
  });
});

describe("quotation-approval-domain", () => {
  it("breachesThreshold is strict >", () => {
    expect(breachesThreshold(1001, 1000)).toBe(true);
    expect(breachesThreshold(1000, 1000)).toBe(false);
  });
  it("initialStatus: within threshold auto-approves, breach pends", () => {
    expect(initialStatus(500, { maxDiscountBps: 1000, enabled: true })).toBe("approved");
    expect(initialStatus(1500, { maxDiscountBps: 1000, enabled: true })).toBe("pending");
  });
  it("initialStatus: no policy => any positive discount pends, zero approves", () => {
    expect(initialStatus(0, null)).toBe("approved");
    expect(initialStatus(1, null)).toBe("pending");
    expect(initialStatus(1, { maxDiscountBps: 1000, enabled: false })).toBe("pending");
  });
  it("breachSnapshot records discount vs limit (+ advisory requested)", () => {
    expect(breachSnapshot("discount", 2500, { maxDiscountBps: 1000 })).toEqual({
      approvalType: "discount", discountBps: 2500, maxDiscountBps: 1000,
    });
    expect(breachSnapshot("discount", 2500, { maxDiscountBps: 1000 }, 500).requestedDiscountBps).toBe(500);
    expect(breachSnapshot("deviation", 100, null).maxDiscountBps).toBe(0);
  });

  describe("effectiveDiscountBps (server-derived, paise, no float)", () => {
    it("derives discount vs reference across lines", () => {
      // 10 units @ 700000 quoted vs 1000000 reference => 30% => 3000 bps.
      expect(effectiveDiscountBps([{ refUnitMinor: "1000000", unitPriceMinor: "700000", quantity: 10 }])).toBe(3000);
    });
    it("ignores lines with no reference price", () => {
      expect(effectiveDiscountBps([{ refUnitMinor: null, unitPriceMinor: "1", quantity: 100 }])).toBe(0);
    });
    it("returns 0 when quote is at or above reference (a premium)", () => {
      expect(effectiveDiscountBps([{ refUnitMinor: "1000", unitPriceMinor: "1200", quantity: 5 }])).toBe(0);
      expect(effectiveDiscountBps([])).toBe(0);
    });
    it("aggregates a blended discount across mixed lines", () => {
      // line A: ref 100000*1=100000, quoted 100000 (no disc); line B: ref 100000*1, quoted 50000 (50% off B)
      // total ref 200000, discount 50000 => 2500 bps.
      expect(effectiveDiscountBps([
        { refUnitMinor: "100000", unitPriceMinor: "100000", quantity: 1 },
        { refUnitMinor: "100000", unitPriceMinor: "50000", quantity: 1 },
      ])).toBe(2500);
    });
  });
});
