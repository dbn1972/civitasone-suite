import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the loader
const getSlaTicketsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getSlaTickets: () => getSlaTicketsMock(),
}));

// Mock the client tabs component (it uses next/navigation hooks)
vi.mock("./SlaQueueTabs", () => ({
  SlaQueueTabs: ({ current }: { current: string }) => <div data-testid="sla-tabs">{current}</div>,
}));

// GAP-HELPDESK-SLAS-04: mock roleGuard so we can toggle export visibility.
let sessionRoles: string[] = ["helpdesk_admin"];
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, getSessionRoles: () => sessionRoles };
});

import Page from "./page";

function ticket(over: Record<string, unknown>) {
  return {
    id: "x", ticketNo: "T", subject: "S", requesterName: "R",
    priority: "medium", slaStatus: "breached", status: "open",
    createdAt: "2026-01-01T00:00:00Z", assignedTo: undefined,
    ...over,
  };
}

describe("SLA Queue page (GAP-HELPDESK-SLAS-01/03/04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRoles = ["helpdesk_admin"];
  });

  it("SLAS-03: Critical overdue ranks above an older Low ticket", async () => {
    getSlaTicketsMock.mockResolvedValue({
      source: "api",
      data: [
        ticket({ id: "low-old", ticketNo: "LOW-OLD", priority: "low", slaStatus: "breached", createdAt: "2025-01-01T00:00:00Z" }),
        ticket({ id: "crit-new", ticketNo: "CRIT-NEW", priority: "critical", slaStatus: "breached", createdAt: "2026-06-01T00:00:00Z" }),
      ],
    });

    const ui = await Page({ searchParams: {} });
    render(ui);

    // Both should appear
    expect(screen.getByText("CRIT-NEW")).toBeInTheDocument();
    expect(screen.getByText("LOW-OLD")).toBeInTheDocument();

    // CRIT-NEW should appear before LOW-OLD in the document order (DOM position)
    const critEl = screen.getByText("CRIT-NEW");
    const lowEl = screen.getByText("LOW-OLD");
    const position = critEl.compareDocumentPosition(lowEl);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 means lowEl follows critEl
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("SLAS-01: ?bucket=due_soon lists the due-soon tickets", async () => {
    getSlaTicketsMock.mockResolvedValue({
      source: "api",
      data: [
        ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" }),
        ticket({ id: "d1", ticketNo: "DUESOON-1", slaStatus: "due_soon" }),
      ],
    });

    const ui = await Page({ searchParams: { bucket: "due_soon" } });
    render(ui);

    expect(screen.getByText("DUESOON-1")).toBeInTheDocument();
    expect(screen.queryByText("BREACH-1")).not.toBeInTheDocument();
  });

  it("SLAS-01: default bucket is breached", async () => {
    getSlaTicketsMock.mockResolvedValue({
      source: "api",
      data: [
        ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" }),
        ticket({ id: "d1", ticketNo: "DUESOON-1", slaStatus: "due_soon" }),
      ],
    });

    const ui = await Page({ searchParams: {} });
    render(ui);

    expect(screen.getByText("BREACH-1")).toBeInTheDocument();
    expect(screen.queryByText("DUESOON-1")).not.toBeInTheDocument();
  });

  it("SLAS-04: a manager sees the CSV export button", async () => {
    sessionRoles = ["helpdesk_admin"];
    getSlaTicketsMock.mockResolvedValue({
      source: "api",
      data: [ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" })],
    });

    const ui = await Page({ searchParams: {} });
    render(ui);

    expect(screen.getByText(/CSV/)).toBeInTheDocument();
  });

  it("SLAS-04: a non-manager role does NOT see the CSV export button (requester PII)", async () => {
    sessionRoles = ["helpdesk_user"];
    getSlaTicketsMock.mockResolvedValue({
      source: "api",
      data: [ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" })],
    });

    const ui = await Page({ searchParams: {} });
    render(ui);

    expect(screen.getByText("BREACH-1")).toBeInTheDocument();
    expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
  });

  it("SLAS-02: a failing Due Soon bucket does not blank the Breached table", async () => {
    // Breached loaded fine; due_soon fetch errored. The default (breached)
    // bucket must still render its table, not a page-wide error state.
    getSlaTicketsMock.mockResolvedValue({
      source: "error", // merged source is error because one bucket failed
      data: [ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" })],
      bucketSources: { breached: "api", due_soon: "error", within_sla: "api" },
    });

    const ui = await Page({ searchParams: { bucket: "breached" } });
    render(ui);

    // Breached table still renders.
    expect(screen.getByText("BREACH-1")).toBeInTheDocument();
    // Breached stat card shows the count (not an em dash) because its own
    // bucket loaded; the Due Soon stat shows an em dash.
    const dueSoonErrDashes = screen.getAllByText("—");
    expect(dueSoonErrDashes.length).toBeGreaterThanOrEqual(1);
  });

  it("SLAS-02: viewing the failed bucket itself shows the retryable error", async () => {
    getSlaTicketsMock.mockResolvedValue({
      source: "error",
      data: [ticket({ id: "b1", ticketNo: "BREACH-1", slaStatus: "breached" })],
      bucketSources: { breached: "api", due_soon: "error", within_sla: "api" },
    });

    const ui = await Page({ searchParams: { bucket: "due_soon" } });
    render(ui);

    // On the failed bucket, show the retryable error, not a stale/empty table.
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText("BREACH-1")).not.toBeInTheDocument();
  });
});
