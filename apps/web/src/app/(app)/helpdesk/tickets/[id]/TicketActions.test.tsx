import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

  it("DETAIL-04: status='resolved' offers Close only (no Reply / Assign / Resolve)", () => {
    render(<TicketActions ticketId="t1" status="resolved" canAct={true} />);

    expect(screen.queryByRole("button", { name: /resolve/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
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

  describe("internal notes use a real isInternal flag (no [INTERNAL] body prefix)", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);
    });

    async function send(kind: "citizen" | "internal", text: string) {
      render(<TicketActions ticketId="t1" status="open" canAct={true} />);
      fireEvent.click(screen.getByRole("button", { name: /reply/i }));
      fireEvent.click(screen.getByDisplayValue(kind));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: kind === "internal" ? /add internal note/i : /send reply/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    }

    it("an internal note posts isInternal: true with the body exactly as typed", async () => {
      const call = await send("internal", "check with legal first");
      expect(call.url).toBe("/api/proxy/v1/citizen/tickets/t1/notes");
      expect(call.method).toBe("POST");
      expect(call.body).toEqual({ body: "check with legal first", isInternal: true });
      expect(String(call.body.body)).not.toMatch(/\[INTERNAL\]/);
    });

    it("a citizen reply sends no isInternal flag", async () => {
      const call = await send("citizen", "we are looking into it");
      expect(call.body).toEqual({ body: "we are looking into it" });
      expect(call.body).not.toHaveProperty("isInternal");
    });
  });
});
