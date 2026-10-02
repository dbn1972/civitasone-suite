import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { NewPaymentForm } from "./NewPaymentForm";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const BILL = "11111111-2222-4333-8444-555555555551";
const bills = [{ id: BILL, billNo: "INV-7", vendor: "Acme Supplies", amount: "4750000" }];
const ddos = [{ id: "DDO12345", label: "DDO12345 — Main DDO" }];

describe("NewPaymentForm (GAP-FINANCE-PAYMENTS-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("cannot submit without a bill and a mode: no fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<NewPaymentForm bills={bills} ddos={ddos} />);
    fireEvent.click(screen.getByRole("button", { name: /review & release/i }));
    expect(await screen.findByText("Choose a passed bill to pay.")).toBeInTheDocument();
    expect(screen.getByText("Choose a payment mode.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("amount comes from the bill; confirm dialog states beneficiary + amount + mode; POST is the initiateEftBody shape, once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<NewPaymentForm bills={bills} ddos={ddos} initialBillId={BILL} />);
    expect(screen.getByLabelText("Passed bill (beneficiary)")).toHaveValue(BILL);
    fireEvent.change(screen.getByLabelText("Payment mode"), { target: { value: "NEFT" } });
    fireEvent.click(screen.getByRole("button", { name: /review & release/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹47,500.00");
    expect(dialog).toHaveTextContent("Acme Supplies");
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Release payment" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/payments/eft");
    expect(JSON.parse(init.body as string)).toEqual({ billId: BILL, ddoCode: "DDO12345", mode: "NEFT", amountMinor: "4750000", currency: "INR" });
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });
});
