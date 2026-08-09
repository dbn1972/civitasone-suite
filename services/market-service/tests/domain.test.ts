import { describe, it, expect } from "vitest";
import {
  canTransition as canAllotmentTransition,
  generateAllotmentNumber,
} from "../src/modules/allotments/domain.js";
import {
  canTransition as canLifecycleTransition,
  generateRequestNumber,
} from "../src/modules/lifecycle/domain.js";

describe("market-service domain", () => {
  it("allows applied → selected allotment", () => {
    expect(canAllotmentTransition("applied", "selected")).toBe(true);
  });
  it("rejects evicted → active allotment", () => {
    expect(canAllotmentTransition("evicted", "active")).toBe(false);
  });
  it("generates allotment number", () => {
    expect(generateAllotmentNumber("DEL", 10)).toMatch(/^MKT\/DEL\/\d{4}\/000010$/);
  });
  it("allows submitted → under_review lifecycle", () => {
    expect(canLifecycleTransition("submitted", "under_review")).toBe(true);
  });
  it("rejects completed → under_review lifecycle", () => {
    expect(canLifecycleTransition("completed", "under_review")).toBe(false);
  });
  it("allows approved → completed lifecycle", () => {
    expect(canLifecycleTransition("approved", "completed")).toBe(true);
  });
  it("generates lifecycle request number", () => {
    expect(generateRequestNumber("MUM", 3)).toMatch(/^MKT-LC\/MUM\/\d{4}\/000003$/);
  });
});