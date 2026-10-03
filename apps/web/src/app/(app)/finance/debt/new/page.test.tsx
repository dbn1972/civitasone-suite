import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import NewDebtPage from "./page";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

function fill() {
  fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "State Development Loan 2031" } });
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "market" } });
  fireEvent.change(screen.getByLabelText("Lender"), { target: { value: "NABARD" } });
  fireEvent.change(screen.getByLabelText("Principal amount (₹)"), { target: { value: "1200000" } });
  fireEvent.change(screen.getByLabelText("Interest rate (% per year)"), { target: { value: "8.5" } });
  fireEvent.change(screen.getByLabelText("Tenure (months)"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("First instalment date"), { target: { value: "2031-05-31" } });
}

describe("NewDebtPage (GAP-FINANCE-DEBT-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("validates every field before anything is sent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<NewDebtPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create loan" }));
    expect(await screen.findByText("Enter the instrument name.")).toBeInTheDocument();
    expect(screen.getByText("Choose a source.")).toBeInTheDocument();
    expect(screen.getByText("Name the lender.")).toBeInTheDocument();
    expect(screen.getByText(/positive amount in rupees/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms with the terms first, then POSTs exact paise and whole basis points", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<NewDebtPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create loan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹12,00,000.00");
    expect(dialog).toHaveTextContent("8.50%");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Record loan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/debt");
    expect(JSON.parse(String(init.body))).toEqual({
      instrument: "State Development Loan 2031", source: "market", lender: "NABARD",
      principalMinor: "120000000", interestRateBps: 850, tenureMonths: 12, firstEmiDate: "2031-05-31",
    });
    expect(await screen.findByText(/Loan recorded/)).toBeInTheDocument();
  });

  it("a failed save is a clerk-safe message, not the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "db_down: pool exhausted" }), { status: 500 }));
    render(<NewDebtPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create loan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record loan" }));
    const alert = await screen.findByText(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/db_down|\b500\b/);
  });

  it("a missing GL-heads setup is explained plainly (409 GL_HEADS_NOT_CONFIGURED), not as a generic failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "GL_HEADS_NOT_CONFIGURED", message: "set the heads" }), { status: 409 }));
    render(<NewDebtPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create loan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record loan" }));
    const msg = await screen.findByText(/loan GL heads are not set up/);
    expect(msg.textContent).not.toMatch(/GL_HEADS_NOT_CONFIGURED|409/);
  });
});
