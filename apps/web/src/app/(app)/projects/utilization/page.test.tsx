import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import UtilizationPage from "./page";

// GAP-PROJECTS-UTILIZATION-01 (HIGH, fabricated data): the page must never
// render the old hard-coded sample projects or hand-typed fund figures that a
// Government user could read as their department's real fund position.
describe("GAP-PROJECTS-UTILIZATION-01: no fabricated fund data", () => {
  it("renders an honest 'not available' empty state instead of sample projects", () => {
    render(UtilizationPage());
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });

  it("does not render any of the old fabricated sample rows", () => {
    render(UtilizationPage());
    for (const literal of [
      "NH-44 Bypass Construction",
      "District Hospital Upgradation - Lucknow",
      "Smart City Phase-II Varanasi",
      "Integrated Water Supply - Dehradun",
      "Solar Power Plant - Jaipur",
      "Urban Metro Corridor - Patna",
    ]) {
      expect(screen.queryByText(literal)).not.toBeInTheDocument();
    }
  });

  it("does not render the old hand-typed fund-position tile numbers", () => {
    render(UtilizationPage());
    expect(screen.queryByText("₹3,359 Cr")).not.toBeInTheDocument();
    expect(screen.queryByText("₹1,586.70 Cr")).not.toBeInTheDocument();
    expect(screen.queryByText("66%")).not.toBeInTheDocument();
    expect(screen.queryByText("₹1,772.30 Cr")).not.toBeInTheDocument();
    // money tiles show honest "—" with no data, not a fabricated ₹0.00
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
