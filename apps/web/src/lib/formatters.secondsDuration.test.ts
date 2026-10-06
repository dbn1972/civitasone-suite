import { describe, it, expect } from "vitest";
import { formatSecondsDuration } from "./formatters";

// GAP-TELEPHONY-CALLS-06
describe("formatSecondsDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatSecondsDuration(184)).toBe("3:04");
    expect(formatSecondsDuration(0)).toBe("0:00");
    expect(formatSecondsDuration(59)).toBe("0:59");
  });

  it("formats durations over an hour as h:mm:ss", () => {
    expect(formatSecondsDuration(3670)).toBe("1:01:10");
    expect(formatSecondsDuration(3600)).toBe("1:00:00");
  });

  it("renders '—' for missing/negative/non-finite (never a fabricated 0:00)", () => {
    expect(formatSecondsDuration(null)).toBe("—");
    expect(formatSecondsDuration(undefined)).toBe("—");
    expect(formatSecondsDuration(-5)).toBe("—");
    expect(formatSecondsDuration(NaN)).toBe("—");
  });
});
