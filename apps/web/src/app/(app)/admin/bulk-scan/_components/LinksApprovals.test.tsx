import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { LinksApprovals, linkActions } from "./LinksApprovals";
import { mapLinks } from "@/lib/bulkScan/mappers";
import { jsonResponse, renderIntl } from "./testHelpers";

const row = (over: Record<string, unknown> = {}) => ({ linkId: "l1", fileId: "f1", documentId: "d1", target: "hr_employee", targetId: "EMP-1", state: "awaiting_approval", requestedBy: "maker-user-1", approvedBy: null, reason: null, createdAt: "2026-10-01T10:00:00.000Z", ...over });
const res = (rows: unknown[]) => ({ data: mapLinks({ data: rows, pagination: { hasMore: false, pageSize: 50 } })!, source: "api" as const });

describe("link approvals: maker-checker", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("pure rule: the requester can never approve; mismatches and awaiting links can be rejected; only linked can be unlinked", () => {
    expect(linkActions({ state: "awaiting_approval", requestedBy: "u1" }, "u1")).toEqual({ approve: false, approveBlockedBySelf: true, reject: true, unlink: false });
    expect(linkActions({ state: "awaiting_approval", requestedBy: "u1" }, "u2")).toMatchObject({ approve: true, approveBlockedBySelf: false });
    expect(linkActions({ state: "flagged_mismatch", requestedBy: "u1" }, "u2")).toMatchObject({ approve: true, reject: true });
    expect(linkActions({ state: "linked", requestedBy: "u1" }, "u1")).toEqual({ approve: false, approveBlockedBySelf: false, reject: false, unlink: true });
    expect(linkActions({ state: "awaiting_approval", requestedBy: "u1" }, null).approve).toBe(true);
  });

  it("my own request: no Approve button, an explanation instead; Reject remains", () => {
    renderIntl(<LinksApprovals result={res([row({ requestedBy: "me-123" })])} state="awaiting_approval" currentUserId="me-123" />);
    expect(screen.queryByRole("button", { name: /Approve link/ })).not.toBeInTheDocument();
    expect(screen.getByText("You requested this link, so a different user must approve it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject link/ })).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval", { selector: ".pill" })).toBeInTheDocument();
  });

  it("another user approves through a confirm dialog", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    renderIntl(<LinksApprovals result={res([row()])} state="awaiting_approval" currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve link to EMP-1" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/links/l1/approve");
  });

  it("the server refusing a self-approval is shown in plain language", async () => {
    f.mockResolvedValue(jsonResponse(409, { code: "MAKER_CHECKER_VIOLATION" }));
    renderIntl(<LinksApprovals result={res([row()])} state="awaiting_approval" currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve link to EMP-1" }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Approve" }));
    expect(await within(dlg).findByText("A different person must approve this. You cannot approve your own request.")).toBeInTheDocument();
  });

  it("reject needs a reason of at least 3 characters; unlink-request needs 5", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    renderIntl(<LinksApprovals result={res([row(), row({ linkId: "l2", targetId: "EMP-2", state: "linked" })])} state="awaiting_approval" currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject link to EMP-1" }));
    let dlg = await screen.findByRole("alertdialog");
    const confirm = within(dlg).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "no" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "wrong person" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ reason: "wrong person" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Request unlink from EMP-2" }));
    dlg = await screen.findByRole("alertdialog");
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "four" } });
    expect(within(dlg).getByRole("button", { name: "Request unlink" })).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "five!" } });
    expect(within(dlg).getByRole("button", { name: "Request unlink" })).toBeEnabled();
  });

  it("a flagged amount mismatch warns before approving", async () => {
    renderIntl(<LinksApprovals result={res([row({ state: "flagged_mismatch", target: "finance_payment" })])} state="flagged_mismatch" currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve link to EMP-1" }));
    expect(await screen.findByText(/amounts do not match/i)).toBeInTheDocument();
  });

  it("a mismatch shows human copy and the expected and scanned amounts; unknown codes are generic; typed reasons are shown as written", () => {
    renderIntl(<LinksApprovals result={res([
      row({ linkId: "m", state: "flagged_mismatch", target: "finance_payment", reason: "AMOUNT_MISMATCH", detail: { expectedMinor: "125000", scannedMinor: "125001" } }),
      row({ linkId: "u", targetId: "EMP-9", state: "rejected", reason: "SOME_FUTURE_CODE" }),
      row({ linkId: "t", targetId: "EMP-8", state: "rejected", reason: "blurry, wrong person" }),
    ])} state="flagged_mismatch" currentUserId="checker-1" />);
    expect(screen.getByText("The amount on the document does not match the finance record.")).toBeInTheDocument();
    expect(screen.getByText("Record amount ₹1,250.00; scanned document ₹1,250.01.")).toBeInTheDocument();
    expect(screen.getByText("The link was not completed.")).toBeInTheDocument();
    expect(screen.queryByText("SOME_FUTURE_CODE")).not.toBeInTheDocument();
    expect(screen.queryByText("AMOUNT_MISMATCH")).not.toBeInTheDocument();
    expect(screen.getByText("blurry, wrong person")).toBeInTheDocument();
  });

  it("empty, error and filtered-empty are different", () => {
    const { unmount } = renderIntl(<LinksApprovals result={res([])} state="linked" currentUserId={null} />);
    expect(screen.getByText("No links in this state")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    renderIntl(<LinksApprovals result={{ data: res([]).data, source: "error", status: 500 }} state="linked" currentUserId={null} />);
    expect(screen.queryByText("No links in this state")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
