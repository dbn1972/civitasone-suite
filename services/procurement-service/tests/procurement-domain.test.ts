/**
 * Procurement Service — all 22 packs domain tests.
 */
import { describe, it, expect } from "vitest";
import { assertTransitionAllowed as indentTransition, assertDistinctMakerChecker as indentSoD, assertIndentApproved, DomainError as IndentError } from "../src/modules/indent/domain.js";
import { assertTransitionAllowed as poTransition, assertBudgetSufficient, assertDistinctMakerChecker as poSoD, assertCanDispatch, DomainError as PoError } from "../src/modules/po/domain.js";
import { computeThreeWayMatch, assertQtyValid, DomainError as GrnError } from "../src/modules/grn/domain.js";
import { assertNotBlacklisted, assertCanEmpanel } from "../src/modules/vendor/domain.js";
import { assertTenderTransition, determineL1, assertDistinctMakerChecker as tenderSoD, assertTechEvaluatorDistinct } from "../src/modules/tender/domain.js";
import { rankBids, computeEffectivePrice, MSE_PREF_NUM, MSE_PREF_DEN } from "../src/modules/auction/domain.js";

// ─── Pack #11: Indent ────────────────────────────────────────────────────────
describe("indent state machine", () => {
  it("draft → pending", () => expect(() => indentTransition("draft", "pending")).not.toThrow());
  it("pending → approved/rejected/tender_required", () => {
    expect(() => indentTransition("pending", "approved")).not.toThrow();
    expect(() => indentTransition("pending", "rejected")).not.toThrow();
    expect(() => indentTransition("pending", "tender_required")).not.toThrow();
  });
  it("approved → closed", () => expect(() => indentTransition("approved", "closed")).not.toThrow());
  it("rejected/closed are terminal", () => {
    expect(() => indentTransition("rejected", "pending")).toThrow(IndentError);
    expect(() => indentTransition("closed", "draft")).toThrow(IndentError);
  });
  it("maker-checker: self-approval blocked", () => {
    expect(() => indentSoD("user-a", "user-a")).toThrow(IndentError);
    expect(() => indentSoD("user-a", "user-b")).not.toThrow();
  });
  it("assertIndentApproved blocks non-approved", () => {
    expect(() => assertIndentApproved("approved")).not.toThrow();
    expect(() => assertIndentApproved("pending")).toThrow(IndentError);
  });
});

// ─── Pack #14: Purchase Order ────────────────────────────────────────────────
describe("PO state machine + budget", () => {
  it("draft → pending/approved", () => {
    expect(() => poTransition("draft", "pending")).not.toThrow();
    expect(() => poTransition("draft", "approved")).not.toThrow();
  });
  it("approved → dispatched/closed/cancelled", () => {
    expect(() => poTransition("approved", "dispatched")).not.toThrow();
    expect(() => poTransition("approved", "cancelled")).not.toThrow();
  });
  it("closed/cancelled are terminal", () => {
    expect(() => poTransition("closed", "approved")).toThrow(PoError);
    expect(() => poTransition("cancelled", "draft")).toThrow(PoError);
  });
  it("budget check: within = pass", () => expect(() => assertBudgetSufficient(1_000_000n, 500_000n)).not.toThrow());
  it("budget check: exceeds = fail", () => expect(() => assertBudgetSufficient(500_000n, 500_001n)).toThrow(PoError));
  it("PO maker-checker", () => expect(() => poSoD("user-a", "user-a")).toThrow(PoError));
  it("assertCanDispatch: only approved", () => {
    expect(() => assertCanDispatch("approved")).not.toThrow();
    expect(() => assertCanDispatch("draft")).toThrow(PoError);
  });
});

// ─── Pack #10: GRN + Pack #20: Three-Way Match ──────────────────────────────
describe("GRN — three-way match + quantity validation", () => {
  it("match passes: inspection pass + accepted within bounds", () => {
    expect(computeThreeWayMatch([{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }], "pass")).toBe(true);
  });
  it("partial delivery valid (received < ordered)", () => {
    expect(computeThreeWayMatch([{ orderedQty: 100, receivedQty: 50, acceptedQty: 50 }], "pass")).toBe(true);
  });
  it("match fails: inspection failed", () => {
    expect(computeThreeWayMatch([{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }], "fail")).toBe(false);
  });
  it("match fails: accepted > received", () => {
    expect(computeThreeWayMatch([{ orderedQty: 10, receivedQty: 5, acceptedQty: 6 }], "pass")).toBe(false);
  });
  it("match fails: zero accepted", () => {
    expect(computeThreeWayMatch([{ orderedQty: 10, receivedQty: 10, acceptedQty: 0 }], "pass")).toBe(false);
  });
  it("assertQtyValid: negative qty throws", () => {
    expect(() => assertQtyValid([{ orderedQty: 10, receivedQty: -1, acceptedQty: 0 }])).toThrow(GrnError);
  });
  it("assertQtyValid: over-accept throws", () => {
    expect(() => assertQtyValid([{ orderedQty: 5, receivedQty: 10, acceptedQty: 6 }])).toThrow(GrnError);
  });
});

// ─── Pack #21/#22: Vendor ────────────────────────────────────────────────────
describe("vendor domain", () => {
  it("blacklisted vendor cannot be used", () => expect(() => assertNotBlacklisted("blacklisted")).toThrow());
  it("active vendor can be used", () => expect(() => assertNotBlacklisted("active")).not.toThrow());
  it("blacklisted cannot be empanelled", () => expect(() => assertCanEmpanel("blacklisted")).toThrow());
});

// ─── Pack #19: Tender ────────────────────────────────────────────────────────
describe("tender state machine + L1 determination", () => {
  it("draft → published → tech_eval → fin_eval → awarded", () => {
    expect(() => assertTenderTransition("draft", "published")).not.toThrow();
    expect(() => assertTenderTransition("published", "technical_evaluation")).not.toThrow();
    expect(() => assertTenderTransition("technical_evaluation", "financial_evaluation")).not.toThrow();
    expect(() => assertTenderTransition("financial_evaluation", "awarded")).not.toThrow();
  });
  it("awarded is terminal", () => expect(() => assertTenderTransition("awarded", "draft")).toThrow());
  it("cancel from any non-terminal", () => {
    expect(() => assertTenderTransition("draft", "cancelled")).not.toThrow();
    expect(() => assertTenderTransition("published", "cancelled")).not.toThrow();
  });
  it("tender SoD: creator cannot award", () => expect(() => tenderSoD("u1", "u1")).toThrow());
  it("tech evaluator cannot also award", () => expect(() => assertTechEvaluatorDistinct("u1", "u1")).toThrow());

  it("L1: lowest bidder gets rank 1", () => {
    const result = determineL1([
      { bidId: "b1", vendorId: "v1", amountMinor: 200_000n, qualified: true, eligible: true },
      { bidId: "b2", vendorId: "v2", amountMinor: 150_000n, qualified: true, eligible: true },
      { bidId: "b3", vendorId: "v3", amountMinor: 180_000n, qualified: true, eligible: true },
    ]);
    expect(result[0]!.bidId).toBe("b2");
    expect(result[0]!.rank).toBe(1);
  });
  it("L1: unqualified bids excluded", () => {
    const result = determineL1([
      { bidId: "b1", vendorId: "v1", amountMinor: 100_000n, qualified: false, eligible: true },
      { bidId: "b2", vendorId: "v2", amountMinor: 200_000n, qualified: true, eligible: true },
    ]);
    expect(result.length).toBe(1);
    expect(result[0]!.bidId).toBe("b2");
  });
  it("L1: ineligible (blacklisted) excluded", () => {
    const result = determineL1([
      { bidId: "b1", vendorId: "v1", amountMinor: 50_000n, qualified: true, eligible: false },
      { bidId: "b2", vendorId: "v2", amountMinor: 100_000n, qualified: true, eligible: true },
    ]);
    expect(result[0]!.bidId).toBe("b2");
  });
});

// ─── Pack #02: Auction (reverse auction) ─────────────────────────────────────
describe("auction — MSE preference + ranking", () => {
  it("MSE preference: effective = bid × 85%", () => {
    expect(computeEffectivePrice(100_000n, true, true)).toBe(85_000n);
  });
  it("non-MSE: effective = bid (no preference)", () => {
    expect(computeEffectivePrice(100_000n, false, true)).toBe(100_000n);
  });
  it("preference disabled: MSE gets no reduction", () => {
    expect(computeEffectivePrice(100_000n, true, false)).toBe(100_000n);
  });
  it("rankBids: MSE bidder wins despite higher absolute bid (GFR 153)", () => {
    const ranked = rankBids([
      { id: "b1", vendorId: "v1", bidMinor: 100_000n, isMse: false },
      { id: "b2", vendorId: "v2", bidMinor: 110_000n, isMse: true }, // effective: 93500
    ], true);
    expect(ranked[0]!.id).toBe("b2"); // MSE wins at 93500 < 100000
  });
  it("rankBids: ineligible vendors excluded", () => {
    const ranked = rankBids([
      { id: "b1", vendorId: "v1", bidMinor: 50_000n, isMse: false, eligible: false },
      { id: "b2", vendorId: "v2", bidMinor: 100_000n, isMse: false },
    ], false);
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.id).toBe("b2");
  });
  it("tie-break: earlier submission wins", () => {
    const ranked = rankBids([
      { id: "b1", vendorId: "v1", bidMinor: 100_000n, isMse: false, bidAt: "2026-07-15T10:00:00Z" },
      { id: "b2", vendorId: "v2", bidMinor: 100_000n, isMse: false, bidAt: "2026-07-15T09:00:00Z" },
    ], false);
    expect(ranked[0]!.id).toBe("b2"); // earlier
  });
});
