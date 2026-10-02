import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SADashboardTable } from "./SADashboardTable";

describe("SADashboardTable (GAP-ADMIN-SA-DASHBOARD-02/05)", () => {
  it("empty copy is operator language, with no developer wording", () => {
    render(<SADashboardTable dashboard={{}} />);
    expect(screen.getByText("Platform KPIs are not being reported yet.")).toBeInTheDocument();
    expect(screen.queryByText(/connect to a live platform/i)).not.toBeInTheDocument();
  });

  it("a failed load is not described as 'nothing reported'", () => {
    render(<SADashboardTable dashboard={{}} source="error" />);
    expect(screen.getByText("Couldn't load metrics")).toBeInTheDocument();
    expect(screen.queryByText(/not being reported/i)).not.toBeInTheDocument();
  });

  it("health words get an explicit tone; backend statuses keep the shared map", () => {
    render(
      <SADashboardTable
        dashboard={{ metrics: [
          { metric: "A", category: "c", value: 1, change: "", status: "degraded" },
          { metric: "B", category: "c", value: 1, change: "", status: "healthy" },
          { metric: "C", category: "c", value: 1, change: "", status: "down" },
          { metric: "D", category: "c", value: 1, change: "", status: "active" },
        ] }}
      />,
    );
    expect(screen.getByText("Degraded")).toHaveClass("pill", "warn");
    expect(screen.getByText("Healthy")).toHaveClass("pill", "good");
    expect(screen.getByText("Down")).toHaveClass("pill", "bad");
    expect(screen.getByText("Active")).toHaveClass("pill", "good");
  });
});
