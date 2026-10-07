import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub next/link to a plain <a>
vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode; [k: string]: unknown }) => <a href={props.href}>{props.children}</a> }));

const mockAnalytics = {
  totalTickets: 500,
  openTickets: 120,
  resolvedThisMonth: 45,
  slaBreachedCount: 12,
  avgResolutionHours: 3.5,
  byPriority: [],
  byChannel: [],
};

const mockTickets = Array.from({ length: 50 }, (_, i) => ({
  id: `t${i}`,
  subject: `Ticket ${i}`,
  priority: "Medium" as const,
  status: i < 10 ? "in_progress" as const : "open" as const,
  slaStatus: i < 3 ? "breached" as const : undefined,
}));

let ticketSource = "api";
let analyticsSource = "api";

vi.mock("../../_data/loaders", () => ({
  getHelpdeskTicketList: async () => ({ data: mockTickets, source: ticketSource }),
  getTicketAnalytics: async () => ({ data: mockAnalytics, source: analyticsSource }),
}));

import Page from "./page";

describe("Helpdesk home (GAP-HELPDESK-HOME-01/02/03)", () => {
  beforeEach(() => {
    ticketSource = "api";
    analyticsSource = "api";
  });

  it("shows Total/Open/SLA Breached from analytics, not the ticket list length (HOME-01/03)", async () => {
    // mockTickets.length = 50 but analytics.totalTickets = 500
    render(await Page());
    // Total stat card shows analytics total (500), NOT the list length (50)
    expect(screen.getByText("500")).toBeInTheDocument();
    // Open shows analytics openTickets (120), not derived from list
    expect(screen.getByText("120")).toBeInTheDocument();
    // SLA Breached shows analytics slaBreachedCount (12)
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows em dash for analytics stats when analytics fails, not zeros (HOME-02)", async () => {
    analyticsSource = "error";
    render(await Page());
    // Total, Open, SLA Breached, SLA % should all be "—"
    const dashes = screen.getAllByText("—");
    // At least 5: Open, SLA Breached, SLA%, Avg Resolution, Total
    expect(dashes.length).toBeGreaterThanOrEqual(5);
  });

  it("still shows ticket-list-derived stats when only analytics fails", async () => {
    analyticsSource = "error";
    render(await Page());
    // In Progress and Pending are still derived from the ticket list
    // 10 tickets have status "in_progress"
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
