import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { InstrumentLifecycleActions } from "./InstrumentLifecycleActions";

describe("InstrumentLifecycleActions (GAP-FINANCE-TREASURY-CHEQUES-03)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("offers only the legal actions for the status", () => {
    const { rerender } = render(<InstrumentLifecycleActions id="i1" instrumentNo="000123" status="presented" />);
    expect(screen.queryByRole("button", { name: "Mark presented" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark cleared" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark bounced" })).toBeInTheDocument();
    rerender(<InstrumentLifecycleActions id="i1" instrumentNo="000123" status="cleared" />);
    expect(screen.queryByRole("button", { name: /Mark/ })).not.toBeInTheDocument();
  });

  it("marks cleared only after confirmation, via the proxy, with an idempotency key, then refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<InstrumentLifecycleActions id="i1" instrumentNo="000123" status="presented" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark cleared" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, mark cleared" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/instruments/i1/clear");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("explains the maker-checker refusal in plain language and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION" }), { status: 403 }));
    render(<InstrumentLifecycleActions id="i1" instrumentNo="000123" status="presented" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark cleared" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, mark cleared" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different finance officer/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
