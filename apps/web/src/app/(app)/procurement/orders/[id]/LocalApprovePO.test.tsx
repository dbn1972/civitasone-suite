import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { LocalApprovePO } from "./LocalApprovePO";

function mockApi(opts: { mode?: "local" | "finance_sanction"; approve?: Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if ((init as RequestInit | undefined)?.method === "PATCH") return opts.approve ?? new Response(JSON.stringify({ id: "po-1", status: "accepted" }), { status: 202 });
    return new Response(JSON.stringify({ mode: opts.mode ?? "local" }), { status: 200, headers: { "content-type": "application/json" } });
  });
}
function renderIt(props: Partial<Parameters<typeof LocalApprovePO>[0]> = {}, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={(locale === "hi" ? hiMessages : enMessages) as never}>
      <LocalApprovePO poId="po-1" status="draft" canApproveRole {...props} />
    </NextIntlClientProvider>,
  );
}

describe("LocalApprovePO (procurement without Finance)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockReset(); });

  it("shows the approve action for a draft PO when the tenant approves locally", async () => {
    mockApi();
    renderIt();
    expect(await screen.findByText("Approve order")).toBeInTheDocument();
    expect(screen.getByText("View approval limits")).toHaveAttribute("href", "/procurement/approval-settings");
  });

  it("renders nothing for a tenant on the finance-sanction path", async () => {
    const spy = mockApi({ mode: "finance_sanction" });
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages as never}><LocalApprovePO poId="po-1" status="draft" canApproveRole /></NextIntlClientProvider>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing, and does not even ask, for an approved PO or a role that cannot approve", async () => {
    const spy = mockApi();
    renderIt({ status: "approved" });
    renderIt({ canApproveRole: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText("Approve order")).toBeNull();
  });

  it("renders nothing when the mode cannot be read", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderIt();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Approve order")).toBeNull();
  });

  it("approves on confirm, sending the optional reason, and refreshes the page", async () => {
    const spy = mockApi();
    renderIt();
    fireEvent.click(await screen.findByText("Approve order"));
    await waitFor(() => expect(screen.getByText("Approve this purchase order?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason or remark/), { target: { value: "Within the delegated limit" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("Purchase order approved.")).toBeInTheDocument());
    const call = spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(String(call[0])).toContain("v1/procurement/pos/po-1/approve");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ reason: "Within the delegated limit" });
    expect(refresh).toHaveBeenCalled();
  });

  it("explains a refusal: the creator cannot approve their own order; a level refusal shows the server's message", async () => {
    mockApi({ approve: new Response(JSON.stringify({ code: "SOD_VIOLATION", message: "x" }), { status: 403 }) });
    renderIt();
    fireEvent.click(await screen.findByText("Approve order"));
    await waitFor(() => expect(screen.getByText("Approve this purchase order?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("You created this order, so another approver must approve it.")).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is translated in Hindi", async () => {
    mockApi();
    renderIt({}, "hi");
    expect(await screen.findByText("आदेश स्वीकृत करें")).toBeInTheDocument();
  });
});
