import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { FinanceChangeRequest } from "@civitasone/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { ChangeRequestsPanel } from "./ChangeRequestsPanel";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const REQ: FinanceChangeRequest = {
  id: "11111111-1111-4111-8111-111111111111", kind: "fiscal_year_activate", subjectKey: "2027-28", payload: { code: "2027-28" },
  reason: "Year-end rollover approved", status: "pending", requestedBy: "maker-1", requestedAt: "2027-03-31T10:00:00.000Z",
  decidedBy: null, decidedAt: null, decisionNote: null, version: 1,
};

describe("ChangeRequestsPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("empty is a calm, real empty state", () => {
    render(<ChangeRequestsPanel requests={[]} viewerId="x" canDecide />);
    expect(screen.getByText("No changes are waiting for approval.")).toBeInTheDocument();
  });

  it("the maker sees 'Raised by you' and can only withdraw, never approve their own", () => {
    render(<ChangeRequestsPanel requests={[REQ]} viewerId="maker-1" canDecide />);
    expect(screen.getByText(/Raised by you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("a user without a decider role is told who must decide, with no buttons", () => {
    render(<ChangeRequestsPanel requests={[REQ]} viewerId="officer-1" canDecide={false} />);
    expect(screen.getByText("A finance administrator must decide this.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("a different admin approves: POSTs once to the approve route and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<ChangeRequestsPanel requests={[REQ]} viewerId="checker-1" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approve this change?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/proxy/v1/finance/change-requests/${REQ.id}/approve`);
    expect(await screen.findByText("Decision recorded. The list updates in a moment.")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reject needs a reason of at least 5 characters and sends it as the note", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<ChangeRequestsPanel requests={[REQ]} viewerId="checker-1" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = (await screen.findAllByRole("button", { name: "Reject" })).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why is this rejected?"), { target: { value: "Periods not closed" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/proxy/v1/finance/change-requests/${REQ.id}/reject`);
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ note: "Periods not closed" });
  });

  it("a maker-checker refusal from the server reads as plain words, never the code or status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "x" }), { status: 409 }));
    render(<ChangeRequestsPanel requests={[REQ]} viewerId="checker-1" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" })).at(-1)!);
    const msg = await screen.findByText(/You raised this change, so a different officer must approve or reject it/);
    expect(msg.textContent).not.toMatch(/MAKER_CHECKER|409/);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("an opening-balance batch and an HoA change are described in words", () => {
    const ob: FinanceChangeRequest = { ...REQ, id: "2", kind: "opening_balances_enter", subjectKey: "2026-27", payload: { entries: [{ debitMinor: "500000" }, { debitMinor: "0" }] } };
    const hoa: FinanceChangeRequest = { ...REQ, id: "3", kind: "hoa_change", subjectKey: "uuid", payload: { headCode: "2110", oldHoaCode: "210100101010101010", hoaCode: "210100101010101011" } };
    render(<ChangeRequestsPanel requests={[ob, hoa]} viewerId="checker-1" canDecide />);
    expect(screen.getByText(/Opening balances for: 2026-27/)).toBeInTheDocument();
    expect(screen.getByText(/2 entries, total debit ₹5,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/HoA code change for head: 2110/)).toBeInTheDocument();
    expect(screen.getByText(/PFMS HoA code: 210100101010101010 → 210100101010101011/)).toBeInTheDocument();
  });

  it("a control-relaxation request names the controls it switches off", () => {
    const rel: FinanceChangeRequest = { ...REQ, id: "4", kind: "settings_relax", subjectKey: "settings", payload: { changes: { makerCheckerEnabled: false } } };
    render(<ChangeRequestsPanel requests={[rel]} viewerId="checker-1" canDecide />);
    expect(screen.getByText(/Switch off a control/)).toBeInTheDocument();
    expect(screen.getByText("Switches off: second approver")).toBeInTheDocument();
  });
});
