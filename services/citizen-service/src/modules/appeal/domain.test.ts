import { describe, it, expect } from "vitest";
import {
  assertWithinFilingWindow,
  deriveFilingWindowDays,
  DEFAULT_FILING_WINDOW_DAYS,
  addDays,
  toDateString,
} from "./domain.js";

describe("GAP-CITIZEN-APPEALS-01 — statutory filing window is server-derived", () => {
  it("ignores a client-sent windowDays and returns the statutory default", () => {
    // The old bug: body.windowDays ?? DEFAULT let a client pass 3650.
    expect(deriveFilingWindowDays({ windowDays: 3650 })).toBe(DEFAULT_FILING_WINDOW_DAYS);
    expect(deriveFilingWindowDays({ windowDays: 1 })).toBe(DEFAULT_FILING_WINDOW_DAYS);
    expect(deriveFilingWindowDays({})).toBe(DEFAULT_FILING_WINDOW_DAYS);
  });

  it("honours a server-resolved per-service override (never the body)", () => {
    expect(deriveFilingWindowDays({ windowDays: 3650 }, 45)).toBe(45);
  });

  it("rejects an appeal filed after the statutory window even though an inflated client windowDays would have allowed it", () => {
    // Decision 90 days ago; statutory window is 30 → must be rejected.
    const decision = new Date();
    decision.setDate(decision.getDate() - 90);
    const windowDays = deriveFilingWindowDays({ windowDays: 3650 }); // 30, not 3650
    expect(() => assertWithinFilingWindow(decision, windowDays)).toThrow("FILING_WINDOW_EXPIRED");
  });

  it("still accepts a timely appeal using the statutory window", () => {
    const decision = new Date();
    decision.setDate(decision.getDate() - 5); // 5 days ago, within 30
    const windowDays = deriveFilingWindowDays({ windowDays: 3650 });
    const { filingDeadline } = assertWithinFilingWindow(decision, windowDays);
    expect(filingDeadline).toBe(toDateString(addDays(decision, DEFAULT_FILING_WINDOW_DAYS)));
  });
});
