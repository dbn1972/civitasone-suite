import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { VendorForm } from "./VendorForm";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

function fill(over: Record<string, string> = {}) {
  const v: Record<string, string> = {
    "Vendor name": "Acme Supplies", Category: "Goods", PAN: "ABCDE1234F", "Registered address": "1 Main Rd",
    "Bank name": "HDFC Bank", "Bank account number": "123456789012", IFSC: "HDFC0001234", ...over,
  };
  for (const [label, value] of Object.entries(v)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("VendorForm (GAP-FINANCE-VENDORS-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks an invalid PAN with a field error and no request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<VendorForm />);
    fill({ PAN: "123" });
    fireEvent.click(screen.getByRole("button", { name: /review & create/i }));
    expect(await screen.findByText(/PAN must look like/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms with a MASKED PAN/account, then POSTs the vendor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<VendorForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /review & create/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).not.toContain("ABCDE1234F");
    expect(dialog.textContent).not.toContain("123456789012");
    expect(dialog).toHaveTextContent("ABCDE****F");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create vendor" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors");
    expect(JSON.parse(init.body as string)).toMatchObject({ name: "Acme Supplies", pan: "ABCDE1234F", ifsc: "HDFC0001234" });
  });

  it("shows a clerk-safe message when the server refuses (e.g. 403)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "role finance_officer lacks" }), { status: 403 }));
    render(<VendorForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /review & create/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Create vendor" }));
    const msg = await screen.findByText(/permission|couldn't|not allowed|access/i);
    expect(msg.textContent).not.toMatch(/finance_officer|403/);
  });
});
