import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PeriodCloseCockpitPage from "./page";

const OPEN_PERIOD = {
  period: "2026-05",
  fiscalYear: "2026-27",
  status: "open",
  closedBy: null,
  closedAt: null,
};

const SOFT_CLOSED_PERIOD = {
  period: "2026-04",
  fiscalYear: "2026-27",
  status: "soft_close",
  closedBy: "11111111-1111-1111-1111-111111111111",
  closedAt: "2026-05-02T00:00:00.000Z",
};

describe("PeriodCloseCockpitPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders tracked periods with status", async () => {
    fetchJsonMock.mockResolvedValue({ data: [OPEN_PERIOD, SOFT_CLOSED_PERIOD], source: "api" });

    const ui = await PeriodCloseCockpitPage();
    render(ui);

    expect(screen.getByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText("2026-04")).toBeInTheDocument();
  });

  it("renders the guided empty state when no periods are tracked yet", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PeriodCloseCockpitPage();
    render(ui);

    expect(screen.getByText("No periods tracked yet")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await PeriodCloseCockpitPage();
    render(ui);

    const badges = screen.getAllByText("Showing saved information");
    expect(badges.length).toBeGreaterThan(0);
    expect(screen.queryByText("No periods tracked yet")).not.toBeInTheDocument();
  });
});
