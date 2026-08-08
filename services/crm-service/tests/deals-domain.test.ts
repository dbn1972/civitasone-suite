/**
 * CRM Deals — quotation, tender, stage-gate, forecast, ageing domain tests.
 * Pack #11. Source: modules/deals/*-domain.ts
 */
import { describe, it, expect } from "vitest";
import { canTransition as canQuoteTransition, isTerminalStatus, sumLineItems, isExpired, isValidRejectReason, REJECT_REASON_MIN_LENGTH } from "../src/modules/deals/quotation-domain.js";
import { canTransition as canBidTransition, isTerminalStage, isValidLossReason, LOSS_REASON_MIN_LENGTH } from "../src/modules/deals/tender-domain.js";
import { isPresent, missingMandatoryFields } from "../src/modules/deals/stage-gate.js";
import { weightedForecast, weightedForecastByStage } from "../src/modules/deals/forecast.js";
import { daysInStage, evaluateAgeing } from "../src/modules/deals/stage-ageing.js";
import { breachesThreshold, initialStatus, effectiveDiscountBps } from "../src/modules/deals/quotation-approval-domain.js";

// ─── Quotation State Machine ─────────────────────────────────────────────────
describe("quotation state machine", () => {
  it("draft → sent", () => expect(canQuoteTransition("draft", "sent")).toBe(true));
  it("sent → accepted/rejected/expired", () => {
    expect(canQuoteTransition("sent", "accepted")).toBe(true);
    expect(canQuoteTransition("sent", "rejected")).toBe(true);
    expect(canQuoteTransition("sent", "expired")).toBe(true);
  });
  it("accepted is terminal", () => expect(isTerminalStatus("accepted")).toBe(true));
  it("rejected is terminal", () => expect(isTerminalStatus("rejected")).toBe(true));
  it("draft → accepted (skip) is illegal", () => expect(canQuoteTransition("draft", "accepted")).toBe(false));
});

describe("sumLineItems — bigint paise", () => {
  it("sums correctly", () => {
    const items = [
      { description: "A", quantity: 2, unitPriceMinor: "50000" },
      { description: "B", quantity: 3, unitPriceMinor: "10000" },
    ];
    expect(sumLineItems(items)).toBe(130_000n); // 100000 + 30000
  });
  it("empty items = 0", () => expect(sumLineItems([])).toBe(0n));
});

describe("isExpired", () => {
  it("expired when validUntil <= now", () => expect(isExpired(new Date("2026-07-01"), new Date("2026-07-15"))).toBe(true));
  it("not expired when validUntil > now", () => expect(isExpired(new Date("2026-08-01"), new Date("2026-07-15"))).toBe(false));
  it("null validUntil = never expires", () => expect(isExpired(null, new Date())).toBe(false));
});

describe("rejection reason validation", () => {
  it("valid when ≥10 chars", () => expect(isValidRejectReason("Not competitive")).toBe(true));
  it("invalid when <10 chars", () => expect(isValidRejectReason("short")).toBe(false));
  it("invalid for null", () => expect(isValidRejectReason(null)).toBe(false));
});

// ─── Tender/Bid State Machine ────────────────────────────────────────────────
describe("tender bid state machine", () => {
  it("linear: identified → qualified → bid_prepared → submitted", () => {
    expect(canBidTransition("identified", "qualified")).toBe(true);
    expect(canBidTransition("qualified", "bid_prepared")).toBe(true);
    expect(canBidTransition("bid_prepared", "submitted")).toBe(true);
  });
  it("submitted → won/lost", () => {
    expect(canBidTransition("submitted", "won")).toBe(true);
    expect(canBidTransition("submitted", "lost")).toBe(true);
  });
  it("won/lost are terminal", () => {
    expect(isTerminalStage("won")).toBe(true);
    expect(isTerminalStage("lost")).toBe(true);
  });
  it("cannot skip stages", () => expect(canBidTransition("identified", "submitted")).toBe(false));
});

// ─── Stage Gate ──────────────────────────────────────────────────────────────
describe("stage-gate: isPresent", () => {
  it("null/undefined = not present", () => { expect(isPresent(null)).toBe(false); expect(isPresent(undefined)).toBe(false); });
  it("empty string = not present", () => expect(isPresent("")).toBe(false));
  it("whitespace-only = not present", () => expect(isPresent("  ")).toBe(false));
  it("empty array = not present", () => expect(isPresent([])).toBe(false));
  it("0 = not present (number)", () => expect(isPresent(0)).toBe(false));
  it("positive number = present", () => expect(isPresent(42)).toBe(true));
  it("non-empty string = present", () => expect(isPresent("hello")).toBe(true));
});

describe("missingMandatoryFields", () => {
  it("returns empty when all present", () => {
    const result = missingMandatoryFields({ product: "Widget", valueMinor: 1000n }, { id: "s1", name: "Negotiation", ordinal: 3, mandatoryFields: ["product", "valueMinor"] });
    expect(result).toEqual([]);
  });
  it("returns missing fields", () => {
    const result = missingMandatoryFields({ product: null, valueMinor: 1000n }, { id: "s1", name: "Negotiation", ordinal: 3, mandatoryFields: ["product", "valueMinor"] });
    expect(result).toEqual(["product"]);
  });
  it("unknown field name reported as missing (fail safe)", () => {
    const result = missingMandatoryFields({}, { id: "s1", name: "X", ordinal: 1, mandatoryFields: ["nonExistentField"] });
    expect(result).toEqual(["nonExistentField"]);
  });
});

// ─── Forecast ────────────────────────────────────────────────────────────────
describe("weightedForecast — bigint", () => {
  it("applies stage probability", () => {
    const deals = [{ id: "d1", stageId: "s1", valueMinor: 1_000_000n }];
    const probs = new Map([["s1", 50]]);
    expect(weightedForecast(deals, probs)).toBe(500_000n);
  });
  it("sums multiple deals", () => {
    const deals = [
      { id: "d1", stageId: "s1", valueMinor: 1_000_000n },
      { id: "d2", stageId: "s2", valueMinor: 2_000_000n },
    ];
    const probs = new Map([["s1", 50], ["s2", 75]]);
    expect(weightedForecast(deals, probs)).toBe(500_000n + 1_500_000n);
  });
  it("unknown stage = 0% probability", () => {
    const deals = [{ id: "d1", stageId: "unknown", valueMinor: 1_000_000n }];
    expect(weightedForecast(deals, new Map())).toBe(0n);
  });
});

// ─── Stage Ageing ────────────────────────────────────────────────────────────
describe("daysInStage / evaluateAgeing", () => {
  it("computes days correctly", () => {
    expect(daysInStage("2026-07-10T00:00:00Z", new Date("2026-07-15T00:00:00Z"))).toBe(5);
  });
  it("null stageEnteredAt = 0 days", () => expect(daysInStage(null, new Date())).toBe(0));
  it("stalled when > maxDays", () => {
    const r = evaluateAgeing({ stageEnteredAt: "2026-07-01T00:00:00Z", maxDays: 10, now: new Date("2026-07-15T00:00:00Z") });
    expect(r.stalled).toBe(true);
    expect(r.daysOverLimit).toBe(4);
  });
  it("not stalled when maxDays is null", () => {
    const r = evaluateAgeing({ stageEnteredAt: "2020-01-01T00:00:00Z", maxDays: null, now: new Date("2026-07-15T00:00:00Z") });
    expect(r.stalled).toBe(false);
  });
});

// ─── Quotation Approval ─────────────────────────────────────────────────────
describe("quotation approval — discount threshold", () => {
  it("breaches when discount > max", () => expect(breachesThreshold(600, 500)).toBe(true));
  it("does not breach at boundary", () => expect(breachesThreshold(500, 500)).toBe(false));
  it("initialStatus: breach → pending", () => expect(initialStatus(600, { maxDiscountBps: 500, enabled: true })).toBe("pending"));
  it("initialStatus: within → approved", () => expect(initialStatus(400, { maxDiscountBps: 500, enabled: true })).toBe("approved"));
  it("initialStatus: no policy + discount → pending", () => expect(initialStatus(100, null)).toBe("pending"));
  it("initialStatus: no policy + zero discount → approved", () => expect(initialStatus(0, null)).toBe("approved"));
});

describe("effectiveDiscountBps — exact bigint", () => {
  it("computes discount from ref vs quoted", () => {
    const lines = [{ refUnitMinor: "10000", unitPriceMinor: "9000", quantity: 10 }];
    // ref total = 100000, quoted = 90000, discount = 10000, bps = 10000*10000/100000 = 1000
    expect(effectiveDiscountBps(lines)).toBe(1000); // 10%
  });
  it("returns 0 when no reference price", () => {
    expect(effectiveDiscountBps([{ refUnitMinor: null, unitPriceMinor: "5000", quantity: 1 }])).toBe(0);
  });
  it("returns 0 when quoted >= ref (premium)", () => {
    expect(effectiveDiscountBps([{ refUnitMinor: "1000", unitPriceMinor: "1200", quantity: 1 }])).toBe(0);
  });
});
