import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RecurringEntriesPage from "./page";

describe("RecurringEntriesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of recurring entries", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          {
            id: "r1",
            name: "Monthly Rent",
            voucher_type: "journal",
            frequency: "monthly",
            amount_minor: "500000",
            next_run_date: "2026-09-01",
            end_date: null,
            is_active: true,
          },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({ data: [{ id: "a1", code: "1000", name: "Cash" }], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("Monthly Rent")).toBeInTheDocument();
  });

  it("renders an empty state when there are no recurring entries", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("No recurring entries yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await RecurringEntriesPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
