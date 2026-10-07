import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/helpdesk/tickets",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock link
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: React.ReactNode; href: string } & Record<string, unknown>) => <a {...props}>{children}</a> }));

// Mock sync/resource — the core of TICKETS-02: useSeededResource drives both
// the table rows AND the stat cards.
const mockSeeded = vi.fn().mockReturnValue({
  data: [] as unknown[],
  provenance: "live",
  offline: false,
  cachedAt: null,
});
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (...args: unknown[]) => mockSeeded(...args),
}));

// Bring the component in AFTER mocks are wired.
import { TicketsTable } from "./TicketsTable";

const sampleTickets = [
  {
    id: "t1", ticketNo: "TKT-001", subject: "Water supply", requesterName: "Ramesh",
    priority: "high", slaStatus: "breached", status: "open", breachRisk: null,
  },
  {
    id: "t2", ticketNo: "TKT-002", subject: "Street light", requesterName: "Suresh",
    priority: "low", slaStatus: "within_sla", status: "resolved", breachRisk: null,
  },
  {
    id: "t3", ticketNo: "TKT-003", subject: "Garbage pickup", requesterName: "Priya",
    priority: "medium", slaStatus: "within_sla", status: "in_progress", breachRisk: null,
  },
];

describe("TicketsTable (GAP-HELPDESK-TICKETS-01/02/05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GAP-HELPDESK-TICKETS-01: source 'error' shows em-dash for Open Tickets and SLA Met, not 0/100%", () => {
    // useSeededResource returns error-no-data provenance when server errored.
    mockSeeded.mockReturnValue({
      data: [],
      provenance: "error-no-data",
      offline: false,
      cachedAt: null,
    });

    render(<TicketsTable tickets={[]} source="error" />);

    // The stat cards should show "—" for Open Tickets and SLA Met.
    const statLabels = screen.getAllByText("—");
    expect(statLabels.length).toBeGreaterThanOrEqual(2);

    // Specifically: "Open Tickets" and "SLA Met" should NOT show 0 or 100%.
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("GAP-HELPDESK-TICKETS-02: stat cards agree with cached rows, not server-supplied empty list", () => {
    // Server gave [] (errored), but cache has 3 tickets. provenance = "cached"
    // (useSeededResource found cache data after server failure).
    mockSeeded.mockReturnValue({
      data: sampleTickets,
      provenance: "cached",
      offline: false,
      cachedAt: "2026-10-01T09:00:00Z",
    });

    render(<TicketsTable tickets={[]} source="error" />);

    // The open count should be 2 (t1=open + t3=in_progress), not 0.
    expect(screen.getByText("2")).toBeInTheDocument();
    // SLA Met should be based on cached data: 2/3 tickets are not breached = 67%
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("GAP-HELPDESK-TICKETS-02: empty valid list shows em-dash for SLA Met, not 100%", () => {
    mockSeeded.mockReturnValue({
      data: [],
      provenance: "live",
      offline: false,
      cachedAt: null,
    });

    render(<TicketsTable tickets={[]} source="api" />);

    // No tickets to measure → SLA Met should be "—".
    // Open Tickets should be "0".
    expect(screen.getByText("0")).toBeInTheDocument();
    // "—" appears for SLA Met (and First Response, CSAT)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("GAP-HELPDESK-TICKETS-05: shows 'No prediction' for tickets without breachRisk", () => {
    mockSeeded.mockReturnValue({
      data: [sampleTickets[0]],
      provenance: "live",
      offline: false,
      cachedAt: null,
    });

    render(<TicketsTable tickets={[sampleTickets[0]!]} source="api" />);

    expect(screen.getByText("No prediction")).toBeInTheDocument();
  });
});
