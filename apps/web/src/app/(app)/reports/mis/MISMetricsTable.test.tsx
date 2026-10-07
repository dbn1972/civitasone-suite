import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MISMetricsTable, formatMetricValue, type MetricRow } from "./MISMetricsTable";

describe("formatMetricValue (GAP-REPORTS-MIS-03)", () => {
  it("groups a money-unit value with Indian digits and a ₹ prefix (NOT paise division)", () => {
    // 125000 is rupees here, not paise — must stay 1,25,000, never 1,250.00.
    expect(formatMetricValue("125000", "₹")).toBe("₹1,25,000");
    expect(formatMetricValue("125000", "INR")).toBe("₹1,25,000");
    expect(formatMetricValue("500", "Rs")).toBe("₹500");
  });

  it("appends % for a percent unit", () => {
    expect(formatMetricValue("80", "%")).toBe("80%");
    expect(formatMetricValue("80", "percent")).toBe("80%");
  });

  it("groups a plain count with Indian digits and no symbol", () => {
    expect(formatMetricValue("1234567", "count")).toBe("12,34,567");
    expect(formatMetricValue("12", "count")).toBe("12");
  });

  it("passes a non-numeric value through verbatim", () => {
    expect(formatMetricValue("N/A", "count")).toBe("N/A");
  });
});

describe("MISMetricsTable (GAP-REPORTS-MIS-02)", () => {
  const rows: MetricRow[] = [
    { module: "finance", label: "Pending", value: "12", unit: "count", change: "\u22124" },
    { module: "finance", label: "Growth", value: "80", unit: "%", change: "+5%" },
  ];

  it("renders a non-colour cue alongside the change for each direction", () => {
    render(<MISMetricsTable rows={rows} />);
    // Down cue for the Unicode-minus change, up cue for the +5%.
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getByText("▲")).toBeInTheDocument();
  });

  it("colours a down trend red via the --bad token", () => {
    const { container } = render(<MISMetricsTable rows={[rows[0]!]} />);
    const colored = container.querySelector('span[style*="var(--bad)"]');
    expect(colored).not.toBeNull();
  });
});
