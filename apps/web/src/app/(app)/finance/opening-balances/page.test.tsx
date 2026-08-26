import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OpeningBalancesPage from "./page";

describe("OpeningBalancesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts to choose a fiscal year when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [{ code: "2026-27", label: "FY 2026-27", status: "active" }],
      source: "api",
    });

    const ui = await OpeningBalancesPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose a fiscal year")).toBeInTheDocument();
  });

  it("renders opening balances for the selected fiscal year", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [{ code: "2026-27", label: "FY 2026-27", status: "active" }], source: "api" })
      .mockResolvedValueOnce({
        data: [
          {
            id: "ob1",
            accountCode: "1000",
            debitMinor: "500000",
            creditMinor: "0",
            narration: "Opening cash",
            enteredAt: "2026-04-01",
          },
        ],
        source: "api",
      });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("renders an empty state when there are no opening balances for the fiscal year", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [{ code: "2026-27", label: "FY 2026-27", status: "active" }], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("No opening balances entered")).toBeInTheDocument();
  });

  it("shows the data-source badge when a loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await OpeningBalancesPage({ searchParams: { fy: "2026-27" } });
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
