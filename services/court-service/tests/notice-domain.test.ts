/** Pure-domain tests for the notice + delivery state machines and id derivation. */
import { describe, it, expect } from "vitest";
import {
  canTransition, assertNoticeTransition,
  canDeliveryTransition, assertDeliveryTransition,
  deriveNoticeId, deriveServiceId,
} from "../src/modules/notice/domain.js";

describe("notice domain — lifecycle state machine", () => {
  it("an issued notice can be served, unserved or cancelled", () => {
    expect(canTransition("issued", "served")).toBe(true);
    expect(canTransition("issued", "unserved")).toBe(true);
    expect(canTransition("issued", "cancelled")).toBe(true);
  });

  it("terminal states cannot transition further", () => {
    expect(canTransition("served", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "served")).toBe(false);
    expect(canTransition("unserved", "served")).toBe(false);
    expect(() => assertNoticeTransition("served", "cancelled")).toThrow(/INVALID_NOTICE_TRANSITION/);
  });
});

describe("notice domain — delivery-status state machine", () => {
  it("a pending attempt can resolve to served, unserved or refused", () => {
    expect(canDeliveryTransition("pending", "served")).toBe(true);
    expect(canDeliveryTransition("pending", "unserved")).toBe(true);
    expect(canDeliveryTransition("pending", "refused")).toBe(true);
  });

  it("terminal delivery states cannot transition further", () => {
    expect(canDeliveryTransition("served", "refused")).toBe(false);
    expect(canDeliveryTransition("refused", "served")).toBe(false);
    expect(() => assertDeliveryTransition("served", "refused")).toThrow(/INVALID_DELIVERY_TRANSITION/);
  });
});

describe("notice domain — id derivation", () => {
  const t = "11111111-1111-1111-1111-111111111111";
  const c = "22222222-2222-2222-2222-222222222222";
  const n = "33333333-3333-3333-3333-333333333333";

  it("deriveNoticeId is deterministic per (tenant, case, type, issue date)", () => {
    expect(deriveNoticeId(t, c, "summons", "2026-07-10")).toBe(deriveNoticeId(t, c, "summons", "2026-07-10"));
    expect(deriveNoticeId(t, c, "summons", "2026-07-10")).not.toBe(deriveNoticeId(t, c, "summons", "2026-07-11"));
    expect(deriveNoticeId(t, c, "summons", "2026-07-10")).not.toBe(deriveNoticeId(t, c, "warrant", "2026-07-10"));
  });

  it("deriveServiceId is deterministic per (tenant, notice, mode, seq)", () => {
    expect(deriveServiceId(t, n, "post", 1)).toBe(deriveServiceId(t, n, "post", 1));
    expect(deriveServiceId(t, n, "post", 1)).not.toBe(deriveServiceId(t, n, "post", 2));
    expect(deriveServiceId(t, n, "post", 1)).not.toBe(deriveServiceId(t, n, "email", 1));
  });
});
