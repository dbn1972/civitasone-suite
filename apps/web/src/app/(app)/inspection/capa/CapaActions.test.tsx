import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { CapaRowAction } from "./CapaActions";

describe("CapaRowAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // Regression: CAPA_TRANSITIONS has no open -> completed edge (must go
  // through in_progress first — see capa/domain.ts). status="in_progress" is
  // used here (not "open") because in_progress -> completed is the one that
  // is actually legal; status="open" now renders "Start", not "Complete" —
  // covered by the dedicated "open" test below.
  it("POSTs complete and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-1" status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: /complete/i }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-1/complete");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(refreshMock).toHaveBeenCalled();
  });

  // Regression for the CRITICAL bug: every CAPA is created with status
  // "open" (capa/consumer.ts capaCreate) and, before the capaStart command
  // existed, nothing could ever move it to "in_progress" — /complete always
  // failed with INVALID_TRANSITION, silently, for every real CAPA. This
  // covers the missing "Start" affordance for status="open".
  it("shows Start (not Complete) for status=open, and POSTs /start with no Content-Type/body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-open" status="open" />);
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-open/start");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    // Regression, confirmed live against the real service: a Content-Type:
    // application/json header on a bodyless request survives the /api/proxy
    // catch-all verbatim and gets 400 FST_ERR_CTP_EMPTY_JSON_BODY from
    // Fastify's default JSON parser. There is no body for /start, so there
    // must be no Content-Type header either.
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("also shows Complete (not Start) for status=overdue — overdue can complete directly", async () => {
    render(<CapaRowAction id="capa-od" status="overdue" />);
    expect(screen.queryByRole("button", { name: /start/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete/i })).toBeInTheDocument();
  });

  it("POSTs verify when status is completed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<CapaRowAction id="capa-2" status="completed" />);
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/capa/capa-2/verify");
  });
});
