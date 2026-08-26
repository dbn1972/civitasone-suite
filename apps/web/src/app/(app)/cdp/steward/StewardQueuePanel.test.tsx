import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { StewardQueuePanel } from "./StewardQueuePanel";

const CANDIDATE = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  tenantId: "11111111-0000-0000-0000-000000000001",
  sourceProfileId: "bbbbbbbb-0000-0000-0000-000000000002",
  targetProfileId: "cccccccc-0000-0000-0000-000000000003",
  confidence: "0.9231",
  matchReason: "email + phone match",
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

function queueResponse(items: unknown[] = [CANDIDATE]): Response {
  return new Response(
    JSON.stringify({ data: items, meta: { page: 1, pageSize: 50, total: items.length } }),
    { status: 200 },
  );
}

describe("StewardQueuePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the queue and shows Approve/Reject actions for a pending candidate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(queueResponse());

    render(<StewardQueuePanel />);

    await waitFor(() => expect(screen.getByText("email + phone match")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("shows an empty state, not a false error, when there are no candidates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(queueResponse([]));

    render(<StewardQueuePanel />);

    await waitFor(() => expect(screen.getByText("No merge suggestions")).toBeInTheDocument());
  });

  it("shows an error state on a failed load rather than an empty queue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));

    render(<StewardQueuePanel />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("No merge suggestions")).not.toBeInTheDocument();
  });

  it("approving calls POST /v1/cdp/steward/decide with the correct payload and updates the row", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(queueResponse());

    render(<StewardQueuePanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Approve merge" }));
    await waitFor(() => expect(screen.getByText("Approve this merge?")).toBeInTheDocument());

    // A merge is irreversible — the confirm button must stay disabled until a reason is given.
    const confirmBtn = screen.getByRole("button", { name: "Approve & merge" });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason (why these are the same person)"), {
      target: { value: "Same Aadhaar-linked mobile number" },
    });
    expect(confirmBtn).toBeEnabled();

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: CANDIDATE.id, status: "accepted" }), { status: 202 }));
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/will be merged shortly/)).toBeInTheDocument());

    // The POST hit the real endpoint with the real mergeRequestId/decision/reason.
    const decideCall = fetchSpy.mock.calls.find(([url]) => url === "/api/proxy/v1/cdp/steward/decide");
    expect(decideCall).toBeDefined();
    const [, init] = decideCall as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      mergeRequestId: CANDIDATE.id,
      decision: "approve",
      reason: "Same Aadhaar-linked mobile number",
    });

    // The list reflects the outcome: no more actions offered for this row, submitted state shown.
    expect(screen.queryByRole("button", { name: "Approve merge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.getByText("Submitted…")).toBeInTheDocument();
  });

  it("requires a reason before Reject's confirm is enabled, and surfaces a real server error on failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(queueResponse());

    render(<StewardQueuePanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument());

    // Before the dialog opens, "Reject" is unambiguous (only the row trigger exists).
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText("Reject this merge suggestion?")).toBeInTheDocument());

    // Once open, the trigger and the dialog's own confirm button share the label "Reject" —
    // scope into the dialog for the confirm button specifically.
    const dialog = screen.getByRole("alertdialog");
    const dialogConfirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(dialogConfirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Reason for rejection"), {
      target: { value: "Different citizens, same employer" },
    });
    expect(dialogConfirm).toBeEnabled();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "ALREADY_DECIDED", message: "merge request is already approved" }),
        { status: 409 },
      ),
    );
    fireEvent.click(dialogConfirm);

    await waitFor(() => expect(within(dialog).getByText(/ALREADY_DECIDED/)).toBeInTheDocument());
    // The dialog stays open on failure so the steward can retry or cancel — nothing silently swallowed.
    expect(screen.getByText("Reject this merge suggestion?")).toBeInTheDocument();
  });
});
