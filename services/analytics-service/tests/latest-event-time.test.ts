import { describe, it, expect } from "vitest";
import { formatLatestEventTime } from "../src/modules/kpi/routes.js";

describe("formatLatestEventTime (data-warehouse Last Refresh)", () => {
  const now = new Date("2026-11-20T10:30:45Z");
  it("clamps a future-dated event to now", () => {
    expect(formatLatestEventTime(new Date("2027-01-09T00:00:00Z"), now)).toBe("2026-11-20 10:30");
  });
  it("leaves a past timestamp unchanged", () => {
    expect(formatLatestEventTime(new Date("2026-05-01T08:15:00Z"), now)).toBe("2026-05-01 08:15");
  });
  it("returns an em dash for null/invalid", () => {
    expect(formatLatestEventTime(null, now)).toBe("—");
    expect(formatLatestEventTime(new Date("nope"), now)).toBe("—");
  });
});
