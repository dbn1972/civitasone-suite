import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const rolesMock = vi.fn(() => ["payroll_officer"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));

import PayrollComparisonPage from "./page";
import { mapComparisonResponse } from "./mapComparisonResponse";

describe("PayrollComparisonPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_officer"]);
  });

  it("prompts for two periods when none are selected", async () => {
    render(await PayrollComparisonPage({ searchParams: {} }));
    expect(screen.getByText("Choose two periods to compare")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the comparison table with signed deltas and % change (COMPARISON-04)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        period1: { period: "2025-05", gross: "50000000", net: "45000000", headcount: 40 },
        period2: { period: "2025-06", gross: "52000000", net: "44985000", headcount: 42 },
      },
      source: "api",
    });
    render(await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } }));
    expect(screen.getByText("2025-05 vs 2025-06")).toBeInTheDocument();
    expect(screen.getByText("Gross Pay")).toBeInTheDocument();
    expect(screen.getByText("+4.0%")).toBeInTheDocument();
    // net fell by ₹150.00 -> real minus sign + screen-reader word
    expect(screen.getAllByText("−₹150.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("decrease of").length).toBeGreaterThan(0);
  });

  it("shows an inline field error for a malformed period instead of the generic empty state (COMPARISON-01)", async () => {
    render(await PayrollComparisonPage({ searchParams: { period1: "2026-8", period2: "2026-09" } }));
    expect(screen.getByText(/"2026-8" is not a valid period/)).toBeInTheDocument();
    expect(screen.queryByText("Choose two periods to compare")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Period 1/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("rejects month 13 without calling the API (COMPARISON-01)", async () => {
    render(await PayrollComparisonPage({ searchParams: { period1: "2026-13", period2: "2026-09" } }));
    expect(screen.getByText(/"2026-13" is not a valid period/)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("names the missing period instead of a load failure (COMPARISON-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { period1: { period: "2025-05", gross: "100", net: "90", headcount: 1 }, period2: null },
      source: "api",
    });
    render(await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } }));
    expect(screen.getByText("No payroll register totals were found for 2025-06.")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load payroll comparison.")).not.toBeInTheDocument();
  });

  it("shows a real error state on HTTP failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    render(await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } }));
    expect(screen.getByText("We couldn't load payroll comparison.")).toBeInTheDocument();
    expect(screen.queryByText("No comparison data")).not.toBeInTheDocument();
  });

  it("denies employee sessions without fetching (COMPARISON-03)", async () => {
    rolesMock.mockReturnValue(["employee"]);
    render(await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } }));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});

describe("mapComparisonResponse (COMPARISON-02)", () => {
  it("maps hasData:false to a missing side, keeping the other", () => {
    expect(
      mapComparisonResponse({
        period1: { period: "2025-05", gross: "0", net: "0", headcount: 0, hasData: false },
        period2: { period: "2025-06", gross: "100", net: "90", headcount: 1, hasData: true },
      }),
    ).toEqual({ period1: null, period2: { period: "2025-06", gross: "100", net: "90", headcount: 1, hasData: true } });
  });
  it("returns null only for a malformed body", () => {
    expect(mapComparisonResponse({})).toBeNull();
    expect(mapComparisonResponse(null)).toBeNull();
  });
});
