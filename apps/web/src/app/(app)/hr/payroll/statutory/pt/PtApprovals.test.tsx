import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { PtApprovals } from "./PtApprovals";
import { PtMakerCheckerSetting } from "./PtMakerCheckerSetting";

const slab = { fromMinor: 0, toMinor: 999999999999, taxMinor: 20000, februaryTaxMinor: 30000 };
const REQ = "11111111-1111-4111-8111-111111111111";
const pendingVersion = { id: REQ, kind: "version" as const, stateCode: "MH", effectiveFrom: "2027-04-01", slabs: [slab], reason: null, makerId: "maker-1", createdAt: "2026-10-01T00:00:00Z" };

const confirmIn = async (name: string) => fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));
const wrap = (ui: React.ReactElement) => render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
/** PATCH -> 202 {id}; the request-outcome GET answers with `outcome`. */
const decideThen = (outcome: Record<string, unknown>, patchStatus = 202, patchBody: Record<string, unknown> = { id: REQ }) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
    (init as RequestInit | undefined)?.method === "PATCH"
      ? new Response(JSON.stringify(patchBody), { status: patchStatus })
      : new Response(JSON.stringify(outcome), { status: 200 }));
const renderApprovals = (over: Partial<React.ComponentProps<typeof PtApprovals>> = {}) =>
  wrap(<PtApprovals pending={[pendingVersion]} viewerId="viewer-9" canDecide stateName={(c) => `State ${c}`} {...over} />);

describe("PtApprovals (maker != checker)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows the request without raw ids, with slab detail, and Approve / Reject for someone else's request", () => {
    renderApprovals();
    expect(screen.getByText(/State MH: new version effective/)).toBeInTheDocument();
    expect(screen.getByText(/to no upper bound: ₹200\.00 a month/)).toBeInTheDocument();
    expect(screen.getByText(/February: ₹300\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByText(/maker-1/)).not.toBeInTheDocument();
  });

  it("your own request has no approve / reject, only a waiting note", () => {
    renderApprovals({ viewerId: "maker-1" });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for a different payroll administrator to approve this.")).toBeInTheDocument();
  });

  it("approve: sends the PATCH, waits for the outcome, then confirms and refreshes", async () => {
    const spy = decideThen({ status: "applied", code: null });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await confirmIn("Approve");
    await waitFor(() => expect(screen.getByText("Approved. The change is recorded.")).toBeInTheDocument(), { timeout: 5000 });
    expect(String(spy.mock.calls[0]![0])).toContain(`/versions/requests/${REQ}/approve`);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("a rule that no longer holds at approval time is shown, never reported as approved", async () => {
    decideThen({ status: "rejected", code: "PT_VERSION_EXISTS" });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await confirmIn("Approve");
    await waitFor(() => expect(screen.getByText("Not approved: another version now starts on that date.")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText("Approved. The change is recorded.")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("self-approval refused by the API (403 SELF_APPROVAL_FORBIDDEN) reads as a plain sentence", async () => {
    decideThen({}, 403, { code: "SELF_APPROVAL_FORBIDDEN", message: "raw" });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await confirmIn("Approve");
    await waitFor(() => expect(screen.getByText("You requested this change, so a different payroll administrator must approve it.")).toBeInTheDocument());
    expect(screen.queryByText(/SELF_APPROVAL|raw/)).not.toBeInTheDocument();
  });

  it("when another administrator decided first, the real outcome is shown (not a made-up approval, not 'still processing')", async () => {
    decideThen({ status: "declined", code: null, decidedByViewer: false });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await confirmIn("Approve");
    await waitFor(() => expect(screen.getByText("Already decided: another administrator rejected this first. Nothing was changed.")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText("Approved. The change is recorded.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Still being processed/)).not.toBeInTheDocument();
  });

  it("a request already approved by someone else reads as already decided", async () => {
    decideThen({ status: "applied", code: null, decidedByViewer: false });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await confirmIn("Approve");
    await waitFor(() => expect(screen.getByText(/Already decided: another administrator approved this first/)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("reject: declined outcome says nothing was changed", async () => {
    const spy = decideThen({ status: "declined", code: null });
    renderApprovals();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await confirmIn("Reject");
    await waitFor(() => expect(screen.getByText("Rejected. Nothing was changed.")).toBeInTheDocument(), { timeout: 5000 });
    expect(String(spy.mock.calls[0]![0])).toContain("/reject");
  });
});

describe("PtMakerCheckerSetting", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("turning the switch OFF needs a reason (10+ chars) and is submitted as a request, not applied", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PUT"
        ? new Response(JSON.stringify({ id: REQ }), { status: 202 })
        : new Response(JSON.stringify({ makerChecker: true, pending: [{ kind: "checker_off" }] }), { status: 200 }));
    wrap(<PtMakerCheckerSetting enabled offPending={false} />);
    expect(screen.getByText(/On: a new slab version must be approved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request to turn off" }));
    const submit = await screen.findByRole("button", { name: "Submit request" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for turning it off/), { target: { value: "Single-officer office" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText("Request submitted. A different payroll administrator must approve it.")).toBeInTheDocument(), { timeout: 5000 });
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ makerCheckerEnabled: false, reason: "Single-officer office" });
  });

  it("while a turn-off request is pending, the action is to CANCEL it (switch stays ON), sent as makerCheckerEnabled: true", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PUT"
        ? new Response(JSON.stringify({ id: REQ }), { status: 202 })
        : new Response(JSON.stringify({ makerChecker: true, pending: [] }), { status: 200 }));
    wrap(<PtMakerCheckerSetting enabled offPending />);
    expect(screen.getByText("A request to turn this off is waiting for a different payroll administrator.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request to turn off" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the turn-off request" }));
    const confirm = await screen.findByRole("button", { name: "Cancel the request" });
    expect(confirm).not.toBeDisabled(); // no reason needed to go back to the safer setting
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText("The turn-off request was cancelled. The second approver is still required.")).toBeInTheDocument(), { timeout: 5000 });
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ makerCheckerEnabled: true });
  });

  it("the OFF state tells the user that requests already pending stay pending", () => {
    wrap(<PtMakerCheckerSetting enabled={false} offPending={false} />);
    expect(screen.getByText(/Requests already waiting for approval stay pending/)).toBeInTheDocument();
  });
});
