import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resource = vi.fn();
const metricsResource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  // The page reads two resources: the call rows and the server-side KPI aggregate.
  useOfflineResource: (key: string) => (key.startsWith("telephony.callmetrics") ? metricsResource() : resource()),
}));

import TelephonyCallsPage from "./page";

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


// KPI figures come from the server-side aggregate (already mapped by toCallMetrics),
// not from counting the rows of the list page.
function metrics(over: Record<string, unknown> = {}) {
  return {
    total: 0,
    live: 0,
    answered: 0,
    abandoned: 0,
    slaScored: 0,
    slaMet: 0,
    slaPct: null,
    completed: 0,
    dispositions: [],
    ...over,
  };
}

function call(over: Record<string, unknown>) {
  return {
    id: "c1",
    direction: "inbound",
    callerNumber: "******7210",
    calleeNumber: null,
    status: "completed",
    disposition: "resolved",
    queueId: null,
    agentId: null,
    linkedRefType: null,
    linkedRefId: null,
    hasRecording: false,
    waitSeconds: 12,
    talkSeconds: 184,
    slaAnswered: true,
    abandoned: false,
    startedAt: "2026-09-29T10:00:00.000Z",
    endedAt: "2026-09-29T10:03:04.000Z",
    ...over,
  };
}

describe("TelephonyCallsPage", () => {
  beforeEach(() => {
    resource.mockReset();
    metricsResource.mockReset();
    metricsResource.mockReturnValue(base({ data: metrics() }));
  });

  // GAP-TELEPHONY-CALLS-01
  it("shows 'Loading calls…' while pending — not 'saved data'", () => {
    resource.mockReturnValue(base({ data: [], loading: true, source: "cache", cachedAt: null }));
    render(<TelephonyCallsPage />);
    expect(screen.getByText(/loading calls/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows an error state with Retry (and no 100% SLA) when the first fetch fails with no cache", () => {
    resource.mockReturnValue(base({ data: [], error: "boom", source: "cache", cachedAt: null }));
    render(<TelephonyCallsPage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  // GAP-TELEPHONY-CALLS-02
  it("renders SLA '—' (not 100%) when no call is scored", () => {
    resource.mockReturnValue(base({ data: [call({ slaAnswered: null })] }));
    metricsResource.mockReturnValue(base({ data: metrics({ total: 1, slaScored: 0, slaMet: 0, slaPct: null }) }));
    const { container } = render(<TelephonyCallsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const sla = tiles.find((t) => t.querySelector(".lab")?.textContent === "SLA Answered")!;
    expect(sla.textContent).toContain("—");
    expect(sla.textContent).not.toContain("100%");
  });

  it("shows the server SLA % over scored calls (3 of 4 met -> 75%)", () => {
    resource.mockReturnValue(base({ data: [call({ id: "a" }), call({ id: "d", slaAnswered: false })] }));
    metricsResource.mockReturnValue(base({ data: metrics({ total: 4, answered: 4, slaScored: 4, slaMet: 3, slaPct: 75 }) }));
    const { container } = render(<TelephonyCallsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const sla = tiles.find((t) => t.querySelector(".lab")?.textContent === "SLA Answered")!;
    expect(sla.textContent).toContain("75%");
  });

  // GAP-TELEPHONY-CALLS-03
  it("renders an abandoned call's status pill as 'bad' (red)", () => {
    resource.mockReturnValue(base({ data: [call({ status: "abandoned", abandoned: true, slaAnswered: null })] }));
    const { container } = render(<TelephonyCallsPage />);
    expect(container.querySelector(".pill.bad")).toBeTruthy();
  });

  // GAP-TELEPHONY-CALLS-06
  it("formats Wait/Talk as m:ss, not raw seconds", () => {
    resource.mockReturnValue(base({ data: [call({ waitSeconds: 12, talkSeconds: 184 })] }));
    render(<TelephonyCallsPage />);
    expect(screen.getByText("3:04")).toBeInTheDocument(); // 184s
    expect(screen.queryByText("184s")).not.toBeInTheDocument();
  });

  // Totals are server aggregates: one fetched row, but the tenant has hundreds of calls.
  it("KPI cards show the server totals, not the length of the fetched page", () => {
    resource.mockReturnValue(base({ data: [call({})] }));
    metricsResource.mockReturnValue(
      base({ data: metrics({ total: 1234, live: 7, answered: 1000, abandoned: 55, slaScored: 1000, slaMet: 900, slaPct: 90 }) }),
    );
    const { container } = render(<TelephonyCallsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const tileFor = (label: string) => tiles.find((t) => t.querySelector(".lab")?.textContent === label)!;
    expect(tileFor("Total Calls").textContent).toContain("1,234");
    expect(tileFor("Answered").textContent).toContain("1,000");
    expect(tileFor("Abandoned").textContent).toContain("55");
    expect(tileFor("SLA Answered").textContent).toContain("90%");
  });

  it("shows dashes (not zeros) in the KPI cards when the metrics call failed but the rows loaded", () => {
    resource.mockReturnValue(base({ data: [call({})] }));
    metricsResource.mockReturnValue(base({ data: null, error: "boom" }));
    const { container } = render(<TelephonyCallsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    for (const label of ["Total Calls", "Answered", "Abandoned", "SLA Answered"]) {
      const t = tiles.find((x) => x.querySelector(".lab")?.textContent === label)!;
      expect(t.textContent).toContain("—");
    }
  });

  // GAP-TELEPHONY-CALLS-07: exactly four stat cards (no orphan fifth)
  it("renders exactly four stat cards", () => {
    resource.mockReturnValue(base({ data: [call({})] }));
    const { container } = render(<TelephonyCallsPage />);
    expect(container.querySelectorAll(".stat")).toHaveLength(4);
  });
});
