import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { RecordFilingForm } from "./RecordFilingForm";

function renderForm(currentRevision: number | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RecordFilingForm fy="2025-26" quarter="Q1" currentRevision={currentRevision} />
    </NextIntlClientProvider>,
  );
}

describe("RecordFilingForm (GAP-PAYROLL-RETURNS-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); refreshMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("validates the 15-digit receipt and a non-future date before any request", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the date the statement was filed");
    fireEvent.change(screen.getByLabelText(/^Filed on/), { target: { value: "2025-07-28" } });
    fireEvent.change(screen.getByLabelText(/^Provisional receipt number/), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    expect(screen.getByRole("alert")).toHaveTextContent("exactly 15 digits");
    expect(screen.getByLabelText(/^Provisional receipt number/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a future filing date", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Filed on/), { target: { value: "2999-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Provisional receipt number/), { target: { value: "123456789012345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    expect(screen.getByRole("alert")).toHaveTextContent("not a future date");
  });

  it("confirms, then POSTs the filing as revision 0 and refreshes", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Filed on/), { target: { value: "2025-07-28" } });
    fireEvent.change(screen.getByLabelText(/^Provisional receipt number/), { target: { value: "123456789012345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Q1 2025-26 as filed on 28 Jul 2025 with provisional receipt no. 123456789012345");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record filing" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/statutory/returns/filings");
    expect(JSON.parse(String(init.body))).toEqual({ formType: "24Q", fy: "2025-26", quarter: "Q1", filedOn: "2025-07-28", receiptNo: "123456789012345", revision: 0 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("an existing filing makes this a correction statement: the next revision", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderForm(0);
    expect(screen.getByRole("heading", { name: "Record a correction statement (revision 1)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Filed on/), { target: { value: "2025-09-01" } });
    fireEvent.change(screen.getByLabelText(/^Provisional receipt number/), { target: { value: "111111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Record filing" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).revision).toBe(1);
  });

  it("explains a duplicate receipt number from the server", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: "RECEIPT_ALREADY_RECORDED", message: "dup" }), { status: 409 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Filed on/), { target: { value: "2025-07-28" } });
    fireEvent.change(screen.getByLabelText(/^Provisional receipt number/), { target: { value: "123456789012345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record filing" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Record filing" }));
    await waitFor(() => expect(screen.getByText("This receipt number is already recorded for another statement.")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
