import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ApplicationFeeDialog } from "./ApplicationFeeDialog";

afterEach(() => vi.unstubAllGlobals());

function renderIt() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ApplicationFeeDialog applicationId="app-1" applicantName="Asha Verma" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

function stub(fee: { status: number; body?: unknown }, post?: (url: string, body: unknown) => Response) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(fee.body ?? {}), { status: fee.status });
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    return post ? post(String(url), body) : new Response(JSON.stringify({ data: {} }), { status: 200 });
  }));
  return calls;
}

describe("ApplicationFeeDialog", () => {
  it("offers to assess a fee that was never assessed, passing whether the category certificate was verified", async () => {
    const calls = stub({ status: 404 });
    renderIt();
    expect(await screen.findByText(/no fee has been assessed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Assess fee" }));
    await waitFor(() => expect(calls[0]).toEqual({ url: "/api/proxy/v1/hrms/applications/app-1/fee/assess", body: { categoryVerified: true } }));
  });

  it("shows the paise amount as rupees and records an OFFLINE payment with its reference", async () => {
    const calls = stub({ status: 200, body: { data: { id: "f1", status: "pending", amountMinor: "50000", currency: "INR", provider: "none" } } });
    renderIt();
    expect(await screen.findByText("₹500.00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/challan \/ dd \/ utr reference/i), { target: { value: "UTR123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(calls[0]).toEqual({ url: "/api/proxy/v1/hrms/applications/app-1/fee/pay", body: { mode: "manual", paymentRef: "UTR123456" } }));
  });

  it("an exempt fee has nothing to pay; the reason is shown", async () => {
    stub({ status: 200, body: { data: { id: "f1", status: "exempt", amountMinor: "0", currency: "INR", provider: "none", exemptionReason: "category_SC" } } });
    renderIt();
    expect(await screen.findByText(/exempt: category_SC/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("a payment refused for lack of the admin role says so", async () => {
    stub({ status: 200, body: { data: { id: "f1", status: "pending", amountMinor: "50000", currency: "INR", provider: "none" } } }, () => new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    renderIt();
    fireEvent.change(await screen.findByLabelText(/challan/i), { target: { value: "UTR1" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/needs an hr administrator/i);
  });
});
