import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/entityAdapters/identityUser", () => ({
  searchIdentityUsers: vi.fn().mockResolvedValue([
    { id: "agent-1", label: "Rakesh Kumar" },
    { id: "agent-2", label: "Priya Sharma" },
  ]),
  resolveIdentityUsers: vi.fn().mockResolvedValue([
    { id: "agent-1", label: "Rakesh Kumar" },
  ]),
}));

import { TicketActions } from "./TicketActions";

describe("TicketActions (GAP-HELPDESK-TICKETS-DETAIL-01/03/04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DETAIL-04: status='closed' renders no action buttons", () => {
    render(<TicketActions ticketId="t1" status="closed" canAct={true} />);

    expect(screen.queryByRole("button", { name: /reply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("DETAIL-04: status='resolved' hides Resolve but shows Close", () => {
    render(<TicketActions ticketId="t1" status="resolved" canAct={true} />);

    expect(screen.queryByRole("button", { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /assign/i })).toBeInTheDocument();
  });

  it("DETAIL-04: canAct=false hides all buttons (viewer/citizen role)", () => {
    render(<TicketActions ticketId="t1" status="open" canAct={false} />);

    expect(screen.queryByRole("button", { name: /reply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("DETAIL-03: reply form shows internal-note / citizen-reply toggle", () => {
    render(<TicketActions ticketId="t1" status="open" canAct={true} />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    // Both radio options should be present
    expect(screen.getByDisplayValue("citizen")).toBeInTheDocument();
    expect(screen.getByDisplayValue("internal")).toBeInTheDocument();
  });

  it("DETAIL-03: selecting internal-note mode changes button label and note text", () => {
    render(<TicketActions ticketId="t1" status="open" canAct={true} />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    // Switch to internal note
    const internalRadio = screen.getByDisplayValue("internal");
    fireEvent.click(internalRadio);

    expect(screen.getByRole("button", { name: /add internal note/i })).toBeInTheDocument();
    expect(screen.getByText(/internal notes are for staff only/i)).toBeInTheDocument();
  });

  it("DETAIL-01: assign form uses an entity picker, not a free-text UUID input", () => {
    render(<TicketActions ticketId="t1" status="open" canAct={true} />);

    fireEvent.click(screen.getByRole("button", { name: /assign/i }));

    // Should have a combobox-style search input, not a UUID placeholder input
    const picker = screen.getByRole("combobox");
    expect(picker).toBeInTheDocument();
    expect(picker).toHaveAttribute("placeholder", "Search by agent name…");
    // Should NOT have a UUID placeholder
    expect(screen.queryByPlaceholderText(/550e8400/)).not.toBeInTheDocument();
  });
});
