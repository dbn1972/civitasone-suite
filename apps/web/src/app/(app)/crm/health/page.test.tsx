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

  // GAP-CRM-HEALTH-02 — the average tile is labelled as an at-risk average, and
  // a full 100-row list shows a truncation notice.
  it("labels the average as at-risk and shows a truncation notice at the 100-row cap", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      accountId: `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`,
      score: 20,
      band: "at_risk" as const,
      computedAt: "2026-08-01T00:00:00Z",
    }));
    getWatchlistMock.mockResolvedValue({ data: rows, source: "api" });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthPage();
    render(ui);

    expect(screen.getByText(/Average score \(at-risk accounts\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 100 at-risk accounts/i)).toBeInTheDocument();
  });

  // GAP-CRM-HEALTH-03 — "Call First" prefers the worst account that has a
  // resolved name, never a bare id-suffix label, when a named one exists.
  it("picks a resolved account name for Call First over an unresolved worst", async () => {
    getWatchlistMock.mockResolvedValue({
      data: [
        // Worst score but no matching account → unresolved.
        { accountId: "99999999-9999-9999-9999-999999999999", score: 5, band: "critical", computedAt: "2026-08-01T00:00:00Z" },
        // Slightly higher but named.
        { accountId: "22222222-2222-2222-2222-222222222222", score: 12, band: "critical", computedAt: "2026-08-01T00:00:00Z" },
      ],
      source: "api",
    });
    getAccountsMock.mockResolvedValue({
      data: [{ id: "22222222-2222-2222-2222-222222222222", name: "Bharat Steel", industry: null, website: null, parentId: null, contactCount: 0 }],
      source: "api",
    });

    const ui = await AccountHealthPage();
    render(ui);

    expect(screen.getByText("Call First").nextElementSibling).toHaveTextContent("Bharat Steel");
  });

  // GAP-CRM-HEALTH-06 — the stat tiles use theme tokens (StatCard `tone`), not
  // hard-coded light-pastel hex iconBg values that stay pale in dark mode.
  it("renders stat-tile icon backgrounds from theme tokens, with no literal hex", async () => {
    getWatchlistMock.mockResolvedValue({
      data: [{ accountId: "a", score: 10, band: "critical", computedAt: "2026-08-01T00:00:00Z" }],
      source: "api",
    });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthPage();
    const { container } = render(ui);

    const html = container.innerHTML;
    for (const hex of ["#fee2e2", "#fef3c7", "#e0f2fe", "#fce7f3"]) {
      expect(html).not.toContain(hex);
    }
    // The bad-tone tile paints its icon box with the --badbg token.
    expect(html).toContain("var(--badbg)");
  });
});
