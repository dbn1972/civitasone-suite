import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CostingPage from "./page";

describe("CostingPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for a period when none is given, without fabricating data", async () => {
    const ui = await CostingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose a period")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the costing report for a given period", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ employeeGroup: "Group A", costCenterId: "cc-1", splitPct: 100, allocatedMinor: "500000" }],
      source: "api",
    });

    const ui = await CostingPage({ searchParams: { period: "2026-07" } });
    render(ui);

    expect(screen.getByText("Group A")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the report API fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await CostingPage({ searchParams: { period: "2026-07" } });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("notes the rules list endpoint is not available", async () => {
    const ui = await CostingPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Rules list not yet available")).toBeInTheDocument();
  });
});
