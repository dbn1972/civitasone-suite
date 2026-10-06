import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
}));

import Page from "./page";
import { TelephonyLiveSummary } from "./_components/TelephonyLiveSummary";

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

describe("Telephony hub page", () => {
  beforeEach(() => resource.mockReset());

  // GAP-TELEPHONY-HOME-02: the "Call Log (legacy)" tile is gone.
  it("does not render the legacy Call Log tile", () => {
    resource.mockReturnValue(base({ data: [] }));
    render(<Page />);
    expect(screen.queryByText(/call log \(legacy\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/telephony\/list/i)).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-HOME-04: the three real tiles are present.
  it("renders the three hub tiles", () => {
    resource.mockReturnValue(base({ data: [] }));
    render(<Page />);
    expect(screen.getByText("Call Log")).toBeInTheDocument();
    expect(screen.getByText("Agent Queue")).toBeInTheDocument();
    expect(screen.getByText("Dispositions")).toBeInTheDocument();
  });
});

describe("TelephonyLiveSummary (GAP-TELEPHONY-HOME-03)", () => {
  beforeEach(() => resource.mockReset());

  it("shows live/abandoned/SLA figures from the call list", () => {
    resource.mockReturnValue(
      base({
        data: [
          { status: "queued", abandoned: false, slaAnswered: null },
          { status: "completed", abandoned: false, slaAnswered: true },
          { status: "abandoned", abandoned: true, slaAnswered: null },
        ],
      }),
    );
    const { container } = render(<TelephonyLiveSummary />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const tileFor = (label: string) => tiles.find((t) => t.querySelector(".lab")?.textContent === label)!;
    expect(tileFor("Live (queued/ringing)").textContent).toContain("1");
    expect(tileFor("Abandoned").textContent).toContain("1");
    expect(tileFor("SLA Answered").textContent).toContain("100%"); // 1 of 1 scored met
  });

  it("shows an error (not zeros) when the fetch fails with no cache", () => {
    resource.mockReturnValue(base({ data: [], error: "boom", source: "cache", cachedAt: null }));
    render(<TelephonyLiveSummary />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows SLA '—' (never a fabricated 100%) when nothing is scored", () => {
    resource.mockReturnValue(base({ data: [{ status: "queued", abandoned: false, slaAnswered: null }] }));
    const { container } = render(<TelephonyLiveSummary />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const sla = tiles.find((t) => t.querySelector(".lab")?.textContent === "SLA Answered")!;
    expect(sla.textContent).toContain("—");
    expect(sla.textContent).not.toContain("100%");
  });
});
