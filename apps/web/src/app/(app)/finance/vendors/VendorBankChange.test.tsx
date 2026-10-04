import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { VendorBankChange, type PendingBankChange } from "./VendorBankChange";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const pending = (over: Partial<PendingBankChange> = {}): PendingBankChange => ({
  id: "c1", bankName: "SBI", ifsc: "SBINXXXXXXX", accountMasked: "********5544", reason: "Moved banks",
  proposedByName: "Asha Rao", proposedAtLabel: "02 Jul 2026", proposedByMe: false, ...over,
});

describe("VendorBankChange (GAP-FINANCE-VENDORS-DETAIL-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("proposes a change: validates, confirms with only the last four digits, then POSTs the request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<VendorBankChange vendorId="v1" vendorName="Acme" pending={null} canPropose canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Propose bank change" }));
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThanOrEqual(4);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New bank name"), { target: { value: "State Bank of India" } });
    fireEvent.change(screen.getByLabelText("New account number"), { target: { value: "998877665544" } });
    fireEvent.change(screen.getByLabelText("New IFSC"), { target: { value: "sbin0001234" } });
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "Vendor moved banks" } });
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("ending 5544");
    expect(dialog.textContent).not.toContain("998877665544");
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/v1/bank-change");
    expect(JSON.parse(init.body as string)).toEqual({ bankName: "State Bank of India", bankAccount: "998877665544", ifsc: "SBIN0001234", reason: "Vendor moved banks" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("a pending change shows the banner with proposer NAME and masked account only", () => {
    const { container } = render(<VendorBankChange vendorId="v1" vendorName="Acme" pending={pending()} canPropose canDecide />);
    expect(screen.getByText("Bank change pending approval")).toBeInTheDocument();
    expect(container.textContent).toContain("Asha Rao");
    expect(container.textContent).toContain("********5544");
    expect(screen.queryByRole("button", { name: "Propose bank change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve change" })).toBeInTheDocument();
  });

  it("the proposer is not offered Approve / Reject (maker != checker)", () => {
    render(<VendorBankChange vendorId="v1" vendorName="Acme" pending={pending({ proposedByMe: true })} canPropose canDecide />);
    expect(screen.queryByRole("button", { name: "Approve change" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/different finance admin/i);
  });

  it("a non-approver sees the banner but no decision buttons, and cannot propose when not permitted", () => {
    render(<VendorBankChange vendorId="v1" vendorName="Acme" pending={pending()} canPropose={false} canDecide={false} />);
    expect(screen.queryByRole("button", { name: "Approve change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject change" })).not.toBeInTheDocument();
  });

  it("approving POSTs to the decision route and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<VendorBankChange vendorId="v1" vendorName="Acme" pending={pending()} canPropose canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Approve change" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("/api/proxy/v1/finance/vendors/v1/bank-change/c1/approve");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
