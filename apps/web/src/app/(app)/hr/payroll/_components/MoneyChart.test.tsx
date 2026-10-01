import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MoneyChart } from "./MoneyChart";

// GAP-PAYROLL-GPF-06 / NPS-06: chart values are paise and must be labelled
// as ₹ with lakh grouping, not bare rupee integers like "18330".
describe("MoneyChart", () => {
  it("labels paise values with formatMoney (₹ + lakh grouping)", () => {
    const { container } = render(
      <MoneyChart type="bar" data={[{ label: "26-05", value: 1833000 }, { label: "26-06", value: 12345678901 }]} height={180} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("₹18,330.00");
    expect(text).toContain("₹12,34,56,789.01");
    expect(text).not.toMatch(/(^|[^\d,.])18330([^\d]|$)/);
  });
});
