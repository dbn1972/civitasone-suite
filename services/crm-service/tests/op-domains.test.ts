/**
 * Pure-domain unit tests (no DB): stage-gate, stage-ageing, quotation-approval maths.
 */
import { describe, it, expect } from "vitest";
import { isPresent, missingMandatoryFields, findStage } from "../src/modules/deals/stage-gate.js";
import { daysInStage, evaluateAgeing } from "../src/modules/deals/stage-ageing.js";
import { breachesThreshold, initialStatus, breachSnapshot } from "../src/modules/deals/quotation-approval-domain.js";

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
  it("finds by id first", () => {
    expect(findStage(stages, { stageId: "b" })?.name).toBe("Won");
  });
  it("falls back to name", () => {
    expect(findStage(stages, { stageName: "Lead" })?.id).toBe("a");
  });
  it("returns undefined for unknown / null stage list", () => {
    expect(findStage(stages, { stageName: "Nope" })).toBeUndefined();
    expect(findStage(null, { stageName: "Lead" })).toBeUndefined();
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
  it("breachSnapshot records discount vs limit", () => {
    expect(breachSnapshot("discount", 2500, { maxDiscountBps: 1000 })).toEqual({
      approvalType: "discount", discountBps: 2500, maxDiscountBps: 1000,
    });
    expect(breachSnapshot("deviation", 100, null).maxDiscountBps).toBe(0);
  });
});
