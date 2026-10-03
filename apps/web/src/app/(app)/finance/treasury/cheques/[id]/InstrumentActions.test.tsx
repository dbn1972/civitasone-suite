import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { InstrumentActions } from "./InstrumentActions";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const flags = { canCancel: false, canRepresent: false, canStale: false };

describe("InstrumentActions (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("cancels only after a reason is given, via the proxy, with an idempotency key, then refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel cheque" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    // The reason is mandatory: Confirm stays disabled until one (>= 5 chars) is typed.
    expect(within(dialog).getByRole("button", { name: "Yes, cancel cheque" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Wrong payee" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel cheque" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/instruments/i1/cancel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Wrong payee" });
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("re-presents a bounced cheque with a reason", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} canRepresent />);
    expect(screen.queryByRole("button", { name: "Cancel cheque" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-present cheque" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Funds now available" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Present again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("/api/proxy/v1/finance/instruments/i1/represent");
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ reason: "Funds now available" });
  });

  it("marks a cheque stale after confirmation (no reason needed)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} canStale />);
    fireEvent.click(screen.getByRole("button", { name: "Mark stale" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Mark stale" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("/api/proxy/v1/finance/instruments/i1/stale");
  });

  it("offers nothing when no action is allowed", () => {
    const { container } = render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the plain 'past validity' message for INSTRUMENT_STALE and never the code or status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INSTRUMENT_STALE", message: "x" }), { status: 409 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} canRepresent />);
    fireEvent.click(screen.getByRole("button", { name: "Re-present cheque" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Funds now available" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Present again" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/past its validity period/i);
    expect(alert.textContent).not.toMatch(/INSTRUMENT_STALE|409/);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a refused cancel (409) shows a clerk-safe error and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "ILLEGAL_TRANSITION" }), { status: 409 }));
    render(<InstrumentActions id="i1" instrumentNo="000123" {...flags} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel cheque" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Wrong payee" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel cheque" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(/ILLEGAL_TRANSITION|409/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
