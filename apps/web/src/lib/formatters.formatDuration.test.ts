import { describe, it, expect } from "vitest";
import { formatMinutesDuration } from "./formatters";

describe("formatMinutesDuration (GAP-HELPDESK-CATALOGUE-DETAIL-04)", () => {
  it("formats whole days", () => {
    expect(formatMinutesDuration(4320)).toBe("3 days");
    expect(formatMinutesDuration(1440)).toBe("1 day");
  });

  it("formats hours and minutes", () => {
    expect(formatMinutesDuration(90)).toBe("1 h 30 min");
    expect(formatMinutesDuration(60)).toBe("1 h");
  });

  it("formats minutes only", () => {
    expect(formatMinutesDuration(45)).toBe("45 min");
    expect(formatMinutesDuration(0)).toBe("0 min");
  });

  it("returns an em dash for missing or invalid input", () => {
    expect(formatMinutesDuration(null)).toBe("—");
    expect(formatMinutesDuration(undefined)).toBe("—");
    expect(formatMinutesDuration("")).toBe("—");
    expect(formatMinutesDuration(-5)).toBe("—");
  });

  it("accepts numeric strings", () => {
    expect(formatMinutesDuration("4320")).toBe("3 days");
  });
});
