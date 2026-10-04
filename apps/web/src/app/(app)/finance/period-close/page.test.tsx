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

  // GAP-FINANCE-PERIOD-CLOSE-04
  it("a failed read shows ONE error state with Retry -- no zero stat cards, no form, no empty copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });

    const ui = await PeriodCloseCockpitPage();
    render(ui);

    expect(screen.getByText("We couldn't load the accounting periods because of a problem on our side.")).toBeInTheDocument();
    expect(screen.queryByText("No periods tracked yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Soft-Close a Period")).not.toBeInTheDocument();
    expect(screen.queryByText("Hard-Closed")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PERIOD-CLOSE-06
  it("shows Closed At with a time (IST) and a shortened user id in Closed By", async () => {
    fetchJsonMock.mockResolvedValue({ data: [SOFT_CLOSED_PERIOD], source: "api" });

    const ui = await PeriodCloseCockpitPage();
    render(ui);

    // 2026-05-02T00:00Z == 05:30 am IST
    expect(screen.getByText(/02 May 2026, 05:30 am/i)).toBeInTheDocument();
    expect(screen.getByText("User 11111111")).toBeInTheDocument();
    expect(screen.queryByText("11111111-1111-1111-1111-111111111111")).not.toBeInTheDocument();
  });
});
