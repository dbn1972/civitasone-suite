import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
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
  beforeEach(() => resource.mockReset());

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
    const { container } = render(<TelephonyCallsPage />);
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const sla = tiles.find((t) => t.querySelector(".lab")?.textContent === "SLA Answered")!;
    expect(sla.textContent).toContain("—");
    expect(sla.textContent).not.toContain("100%");
  });

  it("computes SLA % over scored calls (3 of 4 met -> 75%)", () => {
    resource.mockReturnValue(
      base({
        data: [
          call({ id: "a", slaAnswered: true }),
          call({ id: "b", slaAnswered: true }),
          call({ id: "c", slaAnswered: true }),
          call({ id: "d", slaAnswered: false }),
        ],
      }),
    );
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

  // GAP-TELEPHONY-CALLS-07: exactly four stat cards (no orphan fifth)
  it("renders exactly four stat cards", () => {
    resource.mockReturnValue(base({ data: [call({})] }));
    const { container } = render(<TelephonyCallsPage />);
    expect(container.querySelectorAll(".stat")).toHaveLength(4);
  });
});
