import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode }) => <a href={props.href}>{props.children}</a> }));

let ticketSource = "api";
let sessionRoles: string[] = ["helpdesk_user"];

vi.mock("../../../_data/loaders", () => ({
  getInternalHelpdeskTickets: async () => ({
    data: ticketSource === "error" ? [] : [
      { id: "aaaaaaaa-1111", subject: "Printer down", priority: "High", status: "Open" },
    ],
    source: ticketSource,
  }),
}));

vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, getSessionRoles: () => sessionRoles };
});

import Page from "./page";

describe("Internal helpdesk list (GAP-HELPDESK-INTERNAL-01/03)", () => {
  beforeEach(() => {
    ticketSource = "api";
    sessionRoles = ["helpdesk_user"];
  });

  it("shows a retryable error state on fetch failure, not an empty queue (INTERNAL-01)", async () => {
    ticketSource = "error";
    render(await Page());
    // RefreshErrorState renders a "Try again" style action; the "No internal
    // tickets" empty state must NOT appear.
    expect(screen.queryByText("No internal tickets")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("shows + New Ticket for a helpdesk role (INTERNAL-03)", async () => {
    sessionRoles = ["helpdesk_user"];
    render(await Page());
    expect(screen.getByText("+ New Ticket")).toBeInTheDocument();
  });

  it("hides + New Ticket for a non-helpdesk role (INTERNAL-03)", async () => {
    sessionRoles = ["citizen"];
    render(await Page());
    expect(screen.queryByText("+ New Ticket")).not.toBeInTheDocument();
  });
});
