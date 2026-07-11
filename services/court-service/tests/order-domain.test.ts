/** Pure-domain tests for order id derivation + order helpers (§23). */
import { describe, it, expect } from "vitest";
import { deriveOrderId, isSpeakingOrder } from "../src/modules/order/domain.js";

describe("order domain — id derivation", () => {
  it("deriveOrderId is deterministic per (tenant, case, type, idempotencyKey)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const k = "33333333-3333-3333-3333-333333333333";
    expect(deriveOrderId(t, c, "interim", k)).toBe(deriveOrderId(t, c, "interim", k));
  });

  it("deriveOrderId is unique across differing inputs", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    const k = "33333333-3333-3333-3333-333333333333";
    expect(deriveOrderId(t, c, "interim", k)).not.toBe(deriveOrderId(t, c, "final", k));
    expect(deriveOrderId(t, c, "interim", k)).not.toBe(
      deriveOrderId(t, c, "interim", "44444444-4444-4444-4444-444444444444"),
    );
  });
});

describe("order domain — helpers", () => {
  it("isSpeakingOrder is true only for a speaking order", () => {
    expect(isSpeakingOrder("speaking")).toBe(true);
    expect(isSpeakingOrder("interim")).toBe(false);
    expect(isSpeakingOrder("")).toBe(false);
  });
});
