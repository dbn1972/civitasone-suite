import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import { InternalTicketActions } from "./InternalTicketActions";

async function runAction(label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
}

describe("InternalTicketActions (GAP-HELPDESK-INTERNAL-DETAIL-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Resolve POSTs to the service /transition route with { status: resolved }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InternalTicketActions ticketId="t-1" currentStatus="Open" />);
    await runAction(/^resolve$/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/helpdesk/tickets/t-1/transition");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ status: "resolved" });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("Close on a resolved ticket sends { status: closed }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InternalTicketActions ticketId="t-1" currentStatus="Resolved" />);
    await runAction(/^close$/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ status: "closed" });
  });

  it("a failed transition shows an error toast, never a success toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_TRANSITION" } }), { status: 422 })),
    );
    render(<InternalTicketActions ticketId="t-1" currentStatus="Open" />);
    await runAction(/^resolve$/i);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
