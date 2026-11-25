import { describe, it, expect } from "vitest";
import { formatKpiTarget } from "./KpiTable";

describe("formatKpiTarget", () => {
  it("renders null/undefined/empty as an em dash, never \"null\"", () => {
    expect(formatKpiTarget({ target: null })).toBe("—");
    expect(formatKpiTarget({ target: undefined as unknown as null })).toBe("—");
    expect(formatKpiTarget({ target: "" })).toBe("—");
  });
  it("keeps legacy string targets", () => expect(formatKpiTarget({ target: "5d" })).toBe("5d"));
  it("formats numeric targets by unit", () => {
    expect(formatKpiTarget({ target: 10, unit: "percent" })).toBe("10%");
    expect(formatKpiTarget({ target: 1000000, unit: "paise" })).toBe("₹10,000");
    expect(formatKpiTarget({ target: 1200, unit: "count" })).toBe("1,200");
  });
});
