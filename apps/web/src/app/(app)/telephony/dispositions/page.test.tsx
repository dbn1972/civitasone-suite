import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
}));

import TelephonyDispositionsPage from "./page";

function base(over: Record<string, unknown>) {
  return {
    data: [],
    source: "live",
    offline: false,
    cachedAt: null,
    loading: false,
    revalidating: false,
    error: null,
    refresh: vi.fn(),
    ...over,
  };
}

// The breakdown is the server-side aggregate (grouped over EVERY completed call in the
// window), already mapped by toCallMetrics — not derived from one list page.
function agg(dispositions: Array<[string | null, number]>) {
  const completed = dispositions.reduce((a, [, n]) => a + n, 0);
  return {
    total: completed,
    live: 0,
    answered: completed,
    abandoned: 0,
    slaScored: 0,
    slaMet: 0,
    slaPct: null,
    completed,
    dispositions: dispositions.map(([disposition, count]) => ({ disposition, count })),
  };
}

describe("TelephonyDispositionsPage", () => {
  beforeEach(() => resource.mockReset());

  // GAP-TELEPHONY-DISPOSITIONS-01
  it("shows 'Loading dispositions…' while pending — not 'saved data'", () => {
    resource.mockReturnValue(base({ data: null, loading: true, source: "cache", cachedAt: null }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getByText(/loading dispositions/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows an error state with Retry when the first fetch fails with no cache", () => {
    resource.mockReturnValue(base({ data: null, error: "boom", source: "cache", cachedAt: null }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the payload was rejected (data null, no error, not loading)", () => {
    resource.mockReturnValue(base({ data: null, error: null, loading: false }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-DISPOSITIONS-02
  it("subtitle no longer says 'resolved calls'", () => {
    resource.mockReturnValue(base({ data: agg([["resolved", 1]]) }));
    render(<TelephonyDispositionsPage />);
    expect(screen.queryByText(/share of resolved calls/i)).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-DISPOSITIONS-03
  it("buckets completed calls with no disposition under 'No disposition' and Completed counts all", () => {
    resource.mockReturnValue(base({ data: agg([["resolved", 1], ["escalated", 1], [null, 1]]) }));
    const { container } = render(<TelephonyDispositionsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const tileFor = (label: string) => tiles.find((t) => t.querySelector(".lab")?.textContent === label);
    expect(tileFor("Completed")!.textContent).toContain("3");
    expect(tileFor("No disposition")!.textContent).toContain("1");
    // 'No disposition' row also appears in the table
    expect(screen.getAllByText("No disposition").length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TELEPHONY-DISPOSITIONS-04: shares sum to 100 with largest-remainder rounding.
  it("shares from three equal buckets sum to 100", () => {
    resource.mockReturnValue(base({ data: agg([["resolved", 1], ["escalated", 1], ["transferred", 1]]) }));
    render(<TelephonyDispositionsPage />);
    // 1/3 each -> largest-remainder gives 34/33/33 = 100
    const pcts = screen.getAllByText(/^\d+%$/).map((n) => Number(n.textContent!.replace("%", "")));
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  // GAP-TELEPHONY-DISPOSITIONS-05: tenant-defined code appears with a clean label.
  it("humanises a tenant-defined disposition code in the table", () => {
    resource.mockReturnValue(base({ data: agg([["no_resolution", 1]]) }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getAllByText("No resolution").length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TELEPHONY-DISPOSITIONS-06: ProgressBar exposes role=progressbar with aria-valuenow.
  it("renders accessible progress bars", () => {
    resource.mockReturnValue(base({ data: agg([["resolved", 1]]) }));
    render(<TelephonyDispositionsPage />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars[0]).toHaveAttribute("aria-valuenow");
  });

  // Counts are server aggregates: a tenant with thousands of completed calls is not capped at one page.
  it("shows true totals well beyond one 50-row page", () => {
    resource.mockReturnValue(base({ data: agg([["resolved", 3000], ["escalated", 1500], [null, 500]]) }));
    const { container } = render(<TelephonyDispositionsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const tileFor = (label: string) => tiles.find((t) => t.querySelector(".lab")?.textContent === label);
    expect(tileFor("Completed")!.textContent).toContain("5,000");
    expect(tileFor("No disposition")!.textContent).toContain("500");
    expect(tileFor("Resolved")!.textContent).toContain("3,000");
    // shares of 5000: 60 / 30 / 10
    const pcts = screen.getAllByText(/^\d+%$/).map((n) => Number(n.textContent!.replace("%", "")));
    expect(pcts.sort((a, b) => b - a)).toEqual([60, 30, 10]);
  });
});
