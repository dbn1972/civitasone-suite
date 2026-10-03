import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
import { IssueChequeForm } from "./IssueChequeForm";

const renderForm = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><IssueChequeForm /></NextIntlClientProvider>);

function fill() {
  fireEvent.change(screen.getByLabelText("Instrument number"), { target: { value: "000123" } });
  fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "SBI" } });
  fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "ABC Traders" } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1500.50" } });
}

describe("IssueChequeForm (GAP-FINANCE-TREASURY-CHEQUES-03)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); pushMock.mockReset(); });

  it("blocks an incomplete form, showing field errors and sending nothing", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Issue instrument" }));
    expect(screen.getAllByText("This field is required.").length).toBe(3);
    expect(screen.getByText("Enter a positive amount in rupees with at most 2 decimals.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms, then posts integer paise with an idempotency key through the proxy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Issue instrument" }));
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is sent before the officer confirms
    fireEvent.click(await screen.findByRole("button", { name: "Issue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/instruments");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ instrumentType: "cheque", instrumentNo: "000123", payee: "ABC Traders", amountMinor: 150050, currency: "INR" });
    expect(await screen.findByText("Instrument issued.")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows a plain-language error (never a raw status) when the server refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "INSTRUMENT_CONFLICT" }), { status: 409 }));
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Issue instrument" }));
    fireEvent.click(await screen.findByRole("button", { name: "Issue" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/409|INSTRUMENT_CONFLICT/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
