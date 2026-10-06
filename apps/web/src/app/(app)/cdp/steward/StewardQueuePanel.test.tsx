import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function summaryResponse(id: string, attributes: Record<string, unknown>, profileType = "individual"): Response {
  return new Response(JSON.stringify({ data: { id, profileType, attributes } }), { status: 200 });
}

/**
 * Route a fetch mock by URL: the queue returns `queue`, each profile summary
 * returns a name/email/phone bag so STEWARD-02 assertions have something to show.
 */
function routedFetch(queue: Response = queueResponse()) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/v1/cdp/steward/queue")) return Promise.resolve(queue.clone());
    if (url.includes(CANDIDATE.sourceProfileId)) {
      return Promise.resolve(summaryResponse(CANDIDATE.sourceProfileId, { name: "Asha Kumar", email: "asha@dept.gov.in", phone: "9876543210", city: "Pune" }));
    }
    if (url.includes(CANDIDATE.targetProfileId)) {
      return Promise.resolve(summaryResponse(CANDIDATE.targetProfileId, { name: "A. Kumar", email: "a.kumar@dept.gov.in", phone: "9876543211", city: "Pune" }));
    }
    return Promise.resolve(new Response(JSON.stringify({ id: CANDIDATE.id, status: "accepted" }), { status: 202 }));
  });
}

describe("StewardQueuePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try { sessionStorage.clear(); } catch { /* jsdom */ }
  });
  afterEach(() => {
    try { sessionStorage.clear(); } catch { /* jsdom */ }
  });

  it("loads the queue and shows Approve/Reject actions for a steward (canDecide)", async () => {
    routedFetch();

    render(<StewardQueuePanel canDecide />);

    await waitFor(() => expect(screen.getByText("email + phone match")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  // GAP-CDP-STEWARD-01: a non-steward must NOT be offered the irreversible controls.
  it("hides Approve/Reject when the viewer is not a steward (canDecide=false)", async () => {
    routedFetch();

    render(<StewardQueuePanel canDecide={false} />);

    await waitFor(() => expect(screen.getByText("email + phone match")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve merge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  // GAP-CDP-STEWARD-02: the steward sees names (not just UUID prefixes) in the queue.
  it("shows each profile's name in the queue so the steward sees who is being merged", async () => {
    routedFetch();

    render(<StewardQueuePanel canDecide />);

    await waitFor(() => expect(screen.getByText("Asha Kumar")).toBeInTheDocument());
    expect(screen.getByText("A. Kumar")).toBeInTheDocument();
  });

  // GAP-CDP-STEWARD-02: the confirm dialog carries names + masked attributes.
  it("renders a side-by-side comparison with names and masked attributes in the confirm dialog", async () => {
    routedFetch();

    render(<StewardQueuePanel canDecide />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Approve merge" }));
    await waitFor(() => expect(screen.getByText("Approve this merge?")).toBeInTheDocument());

    const dialog = screen.getByRole("alertdialog");
    // Names visible in the dialog (intro sentence + comparison card).
    expect(within(dialog).getAllByText("Asha Kumar").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("A. Kumar").length).toBeGreaterThan(0);
    // Email is masked, never shown in full.
    expect(within(dialog).queryByText("asha@dept.gov.in")).not.toBeInTheDocument();
    expect(within(dialog).getAllByLabelText("masked email").length).toBeGreaterThan(0);
  });

  it("shows an empty state WITH a Refresh control (empty queue can still be re-polled)", async () => {
    routedFetch(queueResponse([]));

    render(<StewardQueuePanel canDecide />);

    await waitFor(() => expect(screen.getByText("No merge suggestions")).toBeInTheDocument());
    // GAP-CDP-STEWARD-05: Refresh must exist even when the queue is empty.
    expect(screen.getAllByRole("button", { name: "Refresh" }).length).toBeGreaterThan(0);
  });

  it("shows an error state on a failed load rather than an empty queue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));

    render(<StewardQueuePanel canDecide />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("No merge suggestions")).not.toBeInTheDocument();
  });

  it("approving calls POST /v1/cdp/steward/decide with the correct payload and updates the row", async () => {
    const fetchSpy = routedFetch();

    render(<StewardQueuePanel canDecide />);
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

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/will be merged into/)).toBeInTheDocument());

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
    expect(screen.getByText("Submitted…")).toBeInTheDocument();
  });

  // GAP-CDP-STEWARD-03: a decided row stays "Submitted…" across a manual Refresh
  // even while the consumer still reports it pending (no second decision offered).
  it("keeps a decided row submitted across Refresh while the server still reports pending", async () => {
    routedFetch();

    render(<StewardQueuePanel canDecide />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Approve merge" }));
    await waitFor(() => expect(screen.getByText("Approve this merge?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason (why these are the same person)"), {
      target: { value: "same person" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve & merge" }));
    await waitFor(() => expect(screen.getByText("Submitted…")).toBeInTheDocument());

    // Manual refresh — server still reports the row pending (consumer lag).
    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[0]);

    await waitFor(() => expect(screen.getByText("Submitted…")).toBeInTheDocument());
    // Crucially, the decision controls are NOT re-offered for this lagging row.
    expect(screen.queryByRole("button", { name: "Approve merge" })).not.toBeInTheDocument();
  });

  it("requires a reason before Reject's confirm is enabled, and surfaces a clerk-safe message on failure, never the server's raw code (UX-020)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/cdp/steward/queue")) return Promise.resolve(queueResponse());
      if (url.includes(CANDIDATE.sourceProfileId)) return Promise.resolve(summaryResponse(CANDIDATE.sourceProfileId, { name: "Asha Kumar" }));
      if (url.includes(CANDIDATE.targetProfileId)) return Promise.resolve(summaryResponse(CANDIDATE.targetProfileId, { name: "A. Kumar" }));
      return Promise.resolve(new Response(JSON.stringify({ id: CANDIDATE.id, status: "accepted" }), { status: 202 }));
    });

    render(<StewardQueuePanel canDecide />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText("Reject this merge suggestion?")).toBeInTheDocument());

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

    await waitFor(() => expect(within(dialog).getByText(/This information was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(within(dialog).queryByText(/ALREADY_DECIDED/)).not.toBeInTheDocument();
    expect(screen.getByText("Reject this merge suggestion?")).toBeInTheDocument();
  });
});
