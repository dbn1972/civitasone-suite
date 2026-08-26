import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PayrollComparisonPage from "./page";

describe("PayrollComparisonPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for two periods when none are selected", async () => {
    const ui = await PayrollComparisonPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose two periods to compare")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the comparison table when both periods are selected", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        period1: { period: "2025-05", gross: 50000000, net: 45000000, headcount: 40 },
        period2: { period: "2025-06", gross: 52000000, net: 46500000, headcount: 42 },
      },
      source: "api",
    });

    const ui = await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } });
    render(ui);

    expect(screen.getByText("2025-05 vs 2025-06")).toBeInTheDocument();
    expect(screen.getByText("Gross Pay")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.queryByText("No comparison data")).not.toBeInTheDocument();
  });

  it("shows a genuine empty state when the API returns no data but is healthy", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await PayrollComparisonPage({ searchParams: { period1: "2025-05", period2: "2025-06" } });
    render(ui);

    expect(screen.getByText("No comparison data")).toBeInTheDocument();
  });
});
