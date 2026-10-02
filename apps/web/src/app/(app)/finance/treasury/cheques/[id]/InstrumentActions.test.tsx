import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { InstrumentActions } from "./InstrumentActions";

describe("InstrumentActions (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("cancels only after confirmation, via the proxy, with an idempotency key, then refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel cheque" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, cancel cheque" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/instruments/i1/cancel");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows a clerk-safe error and does not refresh when the server refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "ILLEGAL_TRANSITION" }), { status: 409 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel cheque" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, cancel cheque" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(/ILLEGAL_TRANSITION|409/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
