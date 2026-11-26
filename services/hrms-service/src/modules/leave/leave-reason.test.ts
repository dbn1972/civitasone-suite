import { describe, it, expect } from "vitest";
import { leaveReasonRefusal, LEAVE_REASON_MIN_LENGTH, LEAVE_REASON_ENFORCED_FROM } from "./validators.js";

const LONG = "Attending my sister's wedding in Mysuru"; // > 20 chars
describe("GAP-HR-LEAVE-APPLY-04 -- server-side 20-character leave reason", () => {
  it("accepts a reason of 20+ characters", () => {
    expect(LEAVE_REASON_MIN_LENGTH).toBe(20);
    expect(leaveReasonRefusal(LONG, undefined)).toBeNull();
    expect(leaveReasonRefusal("x".repeat(20), undefined)).toBeNull();
  });

  it("counts trimmed characters, so padding does not help", () => {
    expect(leaveReasonRefusal("   short   " + " ".repeat(30), undefined)).not.toBeNull();
  });

  it("refuses a 5-character, a missing and an empty reason", () => {
    expect(leaveReasonRefusal("fever", undefined)).toMatch(/at least 20/);
    expect(leaveReasonRefusal(undefined, undefined)).not.toBeNull();
    expect(leaveReasonRefusal("", undefined)).not.toBeNull();
  });

  it("grandfathers an offline request queued before the cut-over (x-queued-at)", () => {
    expect(leaveReasonRefusal("fever", "2026-11-20T10:15:00.000Z")).toBeNull();
    expect(leaveReasonRefusal("fever", ["2026-11-20T10:15:00.000Z"])).toBeNull();
  });

  it("does not grandfather one queued at or after the cut-over, or with a garbage stamp", () => {
    expect(leaveReasonRefusal("fever", LEAVE_REASON_ENFORCED_FROM)).not.toBeNull();
    expect(leaveReasonRefusal("fever", "2026-12-05T08:00:00.000Z")).not.toBeNull();
    expect(leaveReasonRefusal("fever", "not-a-date")).not.toBeNull();
  });
});
