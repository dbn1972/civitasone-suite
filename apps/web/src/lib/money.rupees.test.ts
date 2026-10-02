import { describe, it, expect } from "vitest";
import { parseRupeesToPaise } from "./money";

describe("parseRupeesToPaise (GAP-FINANCE-PFMS-02)", () => {
  it("handles Indian and western grouping without float math", () => {
    expect(parseRupeesToPaise("15,000")).toBe("1500000");
    expect(parseRupeesToPaise("1,20,000.50")).toBe("12000050");
    expect(parseRupeesToPaise("120,000.5")).toBe("12000050");
    expect(parseRupeesToPaise("₹1.15")).toBe("115");
    expect(parseRupeesToPaise("90071992547409.93")).toBe("9007199254740993");
  });
  it("rejects sub-paise, empty, negative and non-numeric input", () => {
    expect(parseRupeesToPaise("12.345")).toBeNull();
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("0")).toBeNull();
  });
  it("rejects commas that are not valid Indian/western grouping (European decimal comma: 100x hazard)", () => {
    for (const bad of ["12,50", "1,5", "1,2345", "12,3456.00", "1,23", "1,,000", ",100", "100,", "1,234,56"]) {
      expect(parseRupeesToPaise(bad), bad).toBeNull();
    }
    expect(parseRupeesToPaise("1,234")).toBe("123400");
    expect(parseRupeesToPaise("12,34,567.89")).toBe("123456789");
    expect(parseRupeesToPaise("1,234,567.89")).toBe("123456789");
  });
});
