import { describe, it, expect } from "vitest";
import { mapTdsFilings, validAckNo, validFilingDate, quarterEnd } from "./tdsFilings";

describe("mapTdsFilings (GAP-FINANCE-STATUTORY-TDS-RETURNS-04)", () => {
  it("maps quarters and normalises an unknown status to pending", () => {
    const rows = mapTdsFilings({ data: [
      { fy: "2026-27", quarter: "Q1", formType: "26Q", dueDate: "2026-07-31", status: "filed", ackNo: "ACK123456", filedOn: "2026-07-20", filedByName: "Asha", deductionCount: 3, totalTdsMinor: "5000", undepositedCount: 0 },
      { fy: "2026-27", quarter: "Q2", dueDate: "2026-10-31", status: "weird" },
    ] });
    expect(rows?.[0]).toMatchObject({ quarter: "Q1", status: "filed", ackNo: "ACK123456", filedByName: "Asha", deductionCount: 3 });
    expect(rows?.[1]).toMatchObject({ quarter: "Q2", status: "pending", ackNo: null, totalTdsMinor: "0", formType: "26Q" });
  });
  it("returns null (an error, not an empty register) when the payload has no data array", () => {
    expect(mapTdsFilings({})).toBeNull();
    expect(mapTdsFilings(null)).toBeNull();
  });
});

describe("filing form rules mirror the server", () => {
  it("acknowledgement number is 6-32 letters or digits", () => {
    expect(validAckNo("ABC123")).toBe(true);
    expect(validAckNo("ab 12")).toBe(false);
    expect(validAckNo("12345")).toBe(false);
  });
  it("quarter ends follow the Indian fiscal year", () => {
    expect(quarterEnd("2026-27", "Q1")).toBe("2026-06-30");
    expect(quarterEnd("2026-27", "Q4")).toBe("2027-03-31");
  });
  it("a filing date must be after the quarter end and not in the future", () => {
    expect(validFilingDate("2026-27", "Q1", "2026-07-15", "2026-10-03")).toBe("ok");
    expect(validFilingDate("2026-27", "Q1", "2026-06-30", "2026-10-03")).toBe("early");
    expect(validFilingDate("2026-27", "Q1", "2026-10-04", "2026-10-03")).toBe("future");
    expect(validFilingDate("2026-27", "Q1", "15/07/2026", "2026-10-03")).toBe("format");
  });
});
