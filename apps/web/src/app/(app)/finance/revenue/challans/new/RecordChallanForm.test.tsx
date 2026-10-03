import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { RecordChallanForm } from "./RecordChallanForm";

const HEADS = [{ id: "9f1b3c1e-0000-4000-8000-000000000001", code: "0021", name: "Income Tax" }];
const renderForm = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><RecordChallanForm heads={HEADS} /></NextIntlClientProvider>);

describe("RecordChallanForm (GAP-FINANCE-REVENUE-CHALLANS-06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requires a receipt head and depositor and a valid amount before anything is sent", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record challan" }));
    expect(screen.getAllByText("This field is required.").length).toBe(2);
    expect(screen.getByText("Enter a positive amount in rupees with at most 2 decimals.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms, then posts the challan in integer paise with an idempotency key (no challan number is invented)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText("Receipt head"), { target: { value: HEADS[0]!.id } });
    fireEvent.change(screen.getByLabelText("Depositor"), { target: { value: "ABC Traders" } });
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "2500.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Record challan" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Record" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/challans");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ receiptHeadId: HEADS[0]!.id, depositor: "ABC Traders", amountMinor: 250075, currency: "INR" });
    expect(await screen.findByText("Challan recorded.")).toBeInTheDocument();
  });
});
