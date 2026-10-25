import { describe, it, expect } from "vitest";
import { dueDateError, todayIST } from "./dueDate";

// 2026-10-25 20:00 UTC is already 2026-10-26 01:30 in IST.
const NOW = new Date("2026-10-25T20:00:00Z");

describe("Log Observation due date (Q33)", () => {
  it("todayIST uses the IST calendar day, not UTC", () => {
    expect(todayIST(NOW)).toBe("2026-10-26");
  });
  it("empty is valid (the field is optional)", () => {
    expect(dueDateError("", NOW)).toBeNull();
    expect(dueDateError("   ", NOW)).toBeNull();
  });
  it("today (IST) and later are valid", () => {
    expect(dueDateError("2026-10-26", NOW)).toBeNull();
    expect(dueDateError("2027-01-01", NOW)).toBeNull();
  });
  it("a date before today in IST is rejected", () => {
    expect(dueDateError("2026-10-25", NOW)).toMatch(/past/i);
  });
  it("malformed or impossible dates are rejected", () => {
    expect(dueDateError("26/10/2026", NOW)).toMatch(/valid/i);
    expect(dueDateError("2026-02-31", NOW)).toMatch(/valid/i);
  });
});
