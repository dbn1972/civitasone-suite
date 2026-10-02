import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { BillForm } from "./BillForm";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const U1 = "11111111-2222-4333-8444-555555555551";
const U2 = "11111111-2222-4333-8444-555555555552";
const vendors = [{ id: U1, label: "Acme Supplies" }];
const heads = [{ id: U2, label: "2110 — Office expenses" }];
const ddos = [{ id: "DDO12345", label: "DDO12345 — Main DDO" }];

describe("BillForm (GAP-FINANCE-EXPENDITURE-BILLS-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows field errors and makes no fetch when vendor/amount are missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<BillForm vendors={vendors} heads={heads} ddos={ddos} />);
    fireEvent.change(screen.getByLabelText("Bill / invoice number"), { target: { value: "INV-1" } });
    fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    expect(await screen.findByText("Choose a vendor.")).toBeInTheDocument();
    expect(screen.getByText(/positive amount/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms, then POSTs vendor, head, DDO and a paise string -- and no `status` key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<BillForm vendors={vendors} heads={heads} ddos={ddos} />);
    fireEvent.change(screen.getByLabelText("Bill / invoice number"), { target: { value: "INV-1" } });
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: U1 } });
    fireEvent.change(screen.getByLabelText("Budget / account head"), { target: { value: U2 } });
    fireEvent.change(screen.getByLabelText("Gross amount (₹)"), { target: { value: "1,234.50" } });
    fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("₹1,234.50");
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Submit bill" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/bills");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ billNo: "INV-1", vendorId: U1, headId: U2, ddoCode: "DDO12345", grossMinor: "123450" });
    expect(body).not.toHaveProperty("status");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });
});
