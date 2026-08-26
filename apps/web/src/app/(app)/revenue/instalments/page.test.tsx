import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InstalmentsPage from "./page";

const assesseesPage = {
  data: [{ id: "a1", ownerName: "Ravi Kumar", identifierNo: "P-001", assesseeType: "property" }],
  source: "api" as const,
};

describe("InstalmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts to choose an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage);

    const ui = await InstalmentsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders instalment plans for the selected assessee", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage).mockResolvedValueOnce({
      data: [
        {
          id: "p1",
          totalMinor: "1200000",
          instalmentCount: 6,
          startDate: "2026-04-01",
          status: "active",
        },
      ],
      source: "api",
    });

    const ui = await InstalmentsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("renders an empty state when there are no instalment plans", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage).mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InstalmentsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("No instalment plans yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when a loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage).mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await InstalmentsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });
});
