/** Pure-domain tests for the hearing state machine + id derivation. */
import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, deriveHearingId } from "../src/modules/hearing/domain.js";

describe("hearing domain — state machine", () => {
  it("a scheduled hearing can be held, adjourned or cancelled", () => {
    expect(canTransition("scheduled", "held")).toBe(true);
    expect(canTransition("scheduled", "adjourned")).toBe(true);
    expect(canTransition("scheduled", "cancelled")).toBe(true);
  });

  it("terminal states cannot transition further", () => {
    expect(canTransition("held", "adjourned")).toBe(false);
    expect(canTransition("adjourned", "held")).toBe(false);
    expect(() => assertTransition("held", "adjourned")).toThrow(/INVALID_HEARING_TRANSITION/);
  });

  it("deriveHearingId is deterministic per (tenant, case, instant)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    expect(deriveHearingId(t, c, "2026-07-10T10:30:00.000Z")).toBe(deriveHearingId(t, c, "2026-07-10T10:30:00.000Z"));
    expect(deriveHearingId(t, c, "2026-07-10T10:30:00.000Z")).not.toBe(deriveHearingId(t, c, "2026-07-11T10:30:00.000Z"));
  });
});
