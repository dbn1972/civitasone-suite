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

function call(status: string, disposition: string | null, id = Math.random().toString()) {
  return { id, status, disposition };
}

describe("TelephonyDispositionsPage", () => {
  beforeEach(() => resource.mockReset());

  // GAP-TELEPHONY-DISPOSITIONS-01
  it("shows 'Loading dispositions…' while pending — not 'saved data'", () => {
    resource.mockReturnValue(base({ data: [], loading: true, source: "cache", cachedAt: null }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getByText(/loading dispositions/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows an error state with Retry when the first fetch fails with no cache", () => {
    resource.mockReturnValue(base({ data: [], error: "boom", source: "cache", cachedAt: null }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-DISPOSITIONS-02
  it("subtitle no longer says 'resolved calls'", () => {
    resource.mockReturnValue(base({ data: [call("completed", "resolved")] }));
    render(<TelephonyDispositionsPage />);
    expect(screen.queryByText(/share of resolved calls/i)).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-DISPOSITIONS-03
  it("buckets completed calls with no disposition under 'No disposition' and Completed counts all", () => {
    resource.mockReturnValue(
      base({
        data: [
          call("completed", "resolved", "a"),
          call("completed", "escalated", "b"),
          call("completed", null, "c"),
        ],
      }),
    );
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
    resource.mockReturnValue(
      base({
        data: [call("completed", "resolved", "a"), call("completed", "escalated", "b"), call("completed", "transferred", "c")],
      }),
    );
    render(<TelephonyDispositionsPage />);
    // 1/3 each -> largest-remainder gives 34/33/33 = 100
    const pcts = screen.getAllByText(/^\d+%$/).map((n) => Number(n.textContent!.replace("%", "")));
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  // GAP-TELEPHONY-DISPOSITIONS-05: tenant-defined code appears with a clean label.
  it("humanises a tenant-defined disposition code in the table", () => {
    resource.mockReturnValue(base({ data: [call("completed", "no_resolution")] }));
    render(<TelephonyDispositionsPage />);
    expect(screen.getAllByText("No resolution").length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TELEPHONY-DISPOSITIONS-06: ProgressBar exposes role=progressbar with aria-valuenow.
  it("renders accessible progress bars", () => {
    resource.mockReturnValue(base({ data: [call("completed", "resolved")] }));
    render(<TelephonyDispositionsPage />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars[0]).toHaveAttribute("aria-valuenow");
  });
});
