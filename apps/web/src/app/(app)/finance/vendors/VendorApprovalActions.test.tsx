import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { VendorApprovalActions } from "./VendorApprovalActions";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("VendorApprovalActions (GAP-FINANCE-VENDORS-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("approves only after confirmation, via the proxy, then refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe={false} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve vendor" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/v1/approve");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    // bound to the vendor version the checker reviewed
    expect(JSON.parse(init.body as string)).toEqual({ version: 3 });
    // a 202 only means "queued": the note says submitted, never that the vendor IS approved
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(/submitted/i);
    expect(note.textContent).not.toMatch(/^Vendor approved|is approved/i);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("the creator is not offered Approve (maker != checker) but can still reject", () => {
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe version={3} />);
    expect(screen.queryByRole("button", { name: "Approve vendor" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/different finance admin/i);
    expect(screen.getByRole("button", { name: "Reject vendor" })).toBeInTheDocument();
  });

  it("reject needs a reason of at least 5 characters and sends it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe={false} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject vendor" }));
    const confirm = await screen.findByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "PAN does not match" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/vendors/v1/reject");
    expect(JSON.parse(init.body as string)).toEqual({ version: 3, reason: "PAN does not match" });
  });

  it("shows the plain maker-checker message when the server refuses, and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "x" }), { status: 409 }));
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe={false} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve vendor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot also approve/i);
    expect(alert.textContent).not.toMatch(/MAKER_CHECKER|409/);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a stale version (vendor edited since) shows the plain reload message and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "VERSION_CONFLICT", message: "x" }), { status: 409 }));
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe={false} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve vendor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/someone else changed this record/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a 202 re-reads the page repeatedly so the queued decision shows up", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { status: "accepted" } }), { status: 202 }));
    render(<VendorApprovalActions id="v1" name="Acme" createdByMe={false} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve vendor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    // immediately, then again after the first settle delay (the queued decision lands in between)
    await waitFor(() => expect(refreshMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
  });
});
