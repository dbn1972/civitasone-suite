import { describe, it, expect } from "vitest";
import { formatCreditHours } from "./formatters";

// GAP-LEARNING-COURSES-03: credit hours arrive as a numeric string ("12.0").
// Old behaviour printed "12.0 hrs"; the new helper must normalise.
describe("formatCreditHours (GAP-LEARNING-COURSES-03)", () => {
  it('renders "12.0" as "12 hrs" (strips trailing .0)', () => {
    expect(formatCreditHours("12.0")).toBe("12 hrs");
  });
  it('renders "1.5" as "1.5 hrs"', () => {
    expect(formatCreditHours("1.5")).toBe("1.5 hrs");
  });
  it('renders "1" / "1.00" as singular "1 hr"', () => {
    expect(formatCreditHours("1")).toBe("1 hr");
    expect(formatCreditHours("1.00")).toBe("1 hr");
  });
  it("renders a number input too", () => {
    expect(formatCreditHours(3)).toBe("3 hrs");
  });
  it('renders missing / unparseable as "—"', () => {
    expect(formatCreditHours(null)).toBe("—");
    expect(formatCreditHours(undefined)).toBe("—");
    expect(formatCreditHours("")).toBe("—");
    expect(formatCreditHours("abc")).toBe("—");
  });
});
