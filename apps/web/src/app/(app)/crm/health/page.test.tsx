import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getWatchlistMock = vi.fn();
const getAccountsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getAccountHealthWatchlist: (...a: unknown[]) => getWatchlistMock(...a),
  getCrmAccounts: (...a: unknown[]) => getAccountsMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AccountHealthPage from "./page";

describe("AccountHealthPage FAILMASK guard (GAP-CRM-HEALTH-01)", () => {
  beforeEach(() => {
    getWatchlistMock.mockReset();
    getAccountsMock.mockReset();
  });

  // Regression for the HIGH bug: a failed load returned [] which the summary
  // turned into Critical=0 / At risk=0 and the table rendered "Every scored
  // account is currently healthy or thriving" — a false all-clear on a risk
  // screen. The page must now fail closed: a retry state, no zeros, no table.
  it("shows a retry state and NO false all-clear when the watchlist fails to load", async () => {
    getWatchlistMock.mockResolvedValue({ data: [], source: "error" });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthPage();
    render(ui);

    expect(screen.getByText(/Account health could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/currently healthy or thriving/i)).not.toBeInTheDocument();
    // No StatGrid tiles rendered on error (Critical / At risk labels absent).
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
    expect(screen.queryByText("At risk")).not.toBeInTheDocument();
  });

  it("also fails closed when the accounts lookup fails", async () => {
    getWatchlistMock.mockResolvedValue({
      data: [{ accountId: "a", score: 10, band: "critical", computedAt: "2026-08-01T00:00:00Z" }],
      source: "api",
    });
    getAccountsMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await AccountHealthPage();
    render(ui);

    expect(screen.getByText(/Account health could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/currently healthy or thriving/i)).not.toBeInTheDocument();
  });

  // A genuinely empty but successful load is NOT an error: it shows the real
  // zeros and the honest "No accounts at risk" empty state.
  it("renders real zeros and the empty watchlist on a healthy empty load", async () => {
    getWatchlistMock.mockResolvedValue({ data: [], source: "api" });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthPage();
    render(ui);

    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("No accounts at risk")).toBeInTheDocument();
  });
});
