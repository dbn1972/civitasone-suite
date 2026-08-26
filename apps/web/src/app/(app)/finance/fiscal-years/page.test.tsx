import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FiscalYearsPage from "./page";

describe("FiscalYearsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of fiscal years", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { code: "2025-26", label: "FY 2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" },
        { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
      ],
      source: "api",
    });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("FY 2025-26")).toBeInTheDocument();
    expect(screen.getByText("FY 2026-27")).toBeInTheDocument();
  });

  it("renders an empty state when there are no fiscal years", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("No fiscal years yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
