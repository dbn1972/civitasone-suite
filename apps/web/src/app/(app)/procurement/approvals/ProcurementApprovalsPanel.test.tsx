import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

// useOfflineResource touches IndexedDB via responseCache — mock it directly so
// this test exercises only ProcurementApprovalsPanel's own filtering/linking
// logic (the thing this regression test is about), not the offline-cache
// layer. Crucially, the real hook applies the component's own `map: toTasks`
// function to the raw payload internally (useOfflineResource(key, path, {map,
// initialData})) — this mock does the same by actually invoking `opts.map`
// on the raw payload the test supplies, so the REAL (unexported) toTasks
// filter is genuinely exercised, not bypassed.
const mockRefresh = vi.fn();
const mockUseOfflineResource = vi.fn((_key: string, _path: string, opts: { map: (raw: unknown) => unknown }) => ({
  data: opts.map(rawPayload),
  loading: false,
  revalidating: false,
  offline: false,
  source: "live" as const,
  cachedAt: null,
  error: mockError,
  refresh: mockRefresh,
}));
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: (...args: [string, string, { map: (raw: unknown) => unknown }]) => mockUseOfflineResource(...args),
}));

const mockFetchOrQueue = vi.fn();
vi.mock("@/lib/sync/requestQueue", () => ({
  fetchOrQueue: (...args: unknown[]) => mockFetchOrQueue(...args),
}));

import { ProcurementApprovalsPanel } from "./ProcurementApprovalsPanel";

type RawTask = {
  id: string;
  instanceId: string;
  name: string;
  status: string;
  roleRef?: string | null;
  refType?: string | null;
  refId?: string | null;
};

// Set by each test before rendering — read by the mocked useOfflineResource
// above so `opts.map` (the component's real toTasks) runs against it.
let rawPayload: RawTask[] | { data: RawTask[]; pagination?: { hasMore?: boolean; total?: number } } = [];
let mockError: string | null = null;

describe("ProcurementApprovalsPanel — REF_TYPES coverage (regression)", () => {
  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    mockFetchOrQueue.mockReset();
    mockRefresh.mockReset();
    rawPayload = [];
    mockError = null;
  });

  // Bug: REF_TYPES used to be Set(["procurement_indent", "procurement_po"]).
  // The backend also raises approval tasks with refType "procurement_plan"
  // (Annual Procurement Plan submit) and "procurement_po_amendment" (PO
  // amendment request) — services/procurement-service's planning/consumer.ts
  // and po/amendment-consumer.ts. Those tasks were silently dropped by
  // toTasks()'s filter, so an approver saw "No pending tasks" even with a real
  // plan or amendment awaiting their decision — a lying empty state, and a
  // task nobody could ever approve or reject through this UI.
  it("shows a pending Annual Procurement Plan approval, linked to the plan detail page", () => {
    rawPayload = [{
      id: "t1", instanceId: "i1", name: "Approve annual plan FY25-26",
      status: "pending", roleRef: "procurement_admin", refType: "procurement_plan", refId: "plan-123",
    }];

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    expect(screen.getByText("Approve annual plan FY25-26")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "plan-123" })).toHaveAttribute(
      "href",
      "/procurement/planning/plan-123",
    );
  });

  it("shows a pending PO amendment approval (as plain text, not a broken link)", () => {
    rawPayload = [{
      id: "t2", instanceId: "i2", name: "Approve PO amendment",
      status: "pending", roleRef: "procurement_admin", refType: "procurement_po_amendment", refId: "amend-456",
    }];

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    expect(screen.getByText("Approve PO amendment")).toBeInTheDocument();
    // No per-amendment detail route exists (refId is the amendment id, not a
    // PO id) — must degrade to plain text, not link to the wrong page.
    expect(screen.queryByRole("link", { name: "amend-456" })).not.toBeInTheDocument();
    expect(screen.getByText("amend-456")).toBeInTheDocument();
  });

  it("still excludes non-procurement and non-pending tasks (filter isn't over-widened)", () => {
    rawPayload = [
      { id: "t3", instanceId: "i3", name: "Unrelated HR task", status: "pending", refType: "hr_leave_approval", refId: "x" },
      { id: "t4", instanceId: "i4", name: "Already-completed indent approval", status: "completed", refType: "procurement_indent", refId: "y" },
    ];

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.getByText("No pending tasks")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated HR task")).not.toBeInTheDocument();
    expect(screen.queryByText("Already-completed indent approval")).not.toBeInTheDocument();
  });

  it("still shows procurement_indent and procurement_po tasks (no regression on the original two types)", () => {
    rawPayload = [
      { id: "t5", instanceId: "i5", name: "Approve indent", status: "pending", refType: "procurement_indent", refId: "ind-1" },
      { id: "t6", instanceId: "i6", name: "Approve PO", status: "pending", refType: "procurement_po", refId: "po-1" },
    ];

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.getByRole("link", { name: "ind-1" })).toHaveAttribute("href", "/procurement/indents/ind-1");
    expect(screen.getByRole("link", { name: "po-1" })).toHaveAttribute("href", "/procurement/orders/po-1");
  });

  // Regression test for a second, distinct L3 bug in this same file: `error`
  // from useOfflineResource was never destructured, so a genuine fetch
  // failure (not offline, nothing cached) fell through to the
  // tasks.length===0 branch and rendered "No pending tasks" — indistinguishable
  // from a genuinely empty, healthy queue. An officer had no way to tell "you
  // have no work" from "we couldn't check your work".
  it("shows a real error state (not 'No pending tasks') when the fetch fails with nothing cached, with working retry", () => {
    rawPayload = [];
    mockError = "HTTP_500";

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t (load|check)/i);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("ProcurementApprovalsPanel — truncation notice (GAP-PROCUREMENT-APPROVALS-01)", () => {
  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    mockFetchOrQueue.mockReset();
    mockRefresh.mockReset();
    rawPayload = [];
    mockError = null;
  });

  it("warns the list may be incomplete when the raw response fills the page limit", () => {
    // 200 pending procurement tasks == the page limit, so more may exist.
    rawPayload = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`, instanceId: `i${i}`, name: `Task ${i}`,
      status: "pending", refType: "procurement_indent", refId: `ind-${i}`,
    }));

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(
      screen.getByText(/Showing the first 200 pending tasks — more may exist/i),
    ).toBeInTheDocument();
  });

  it("shows no truncation notice for a short list", () => {
    rawPayload = [
      { id: "t1", instanceId: "i1", name: "Only task", status: "pending", refType: "procurement_po", refId: "po-1" },
    ];

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText(/more may exist/i)).not.toBeInTheDocument();
  });

  it("requests the four procurement refTypes server-side (additive filter)", () => {
    rawPayload = [];
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    const path = mockUseOfflineResource.mock.calls[0]![1];
    expect(path).toContain("refType=procurement_indent");
    expect(path).toContain("refType=procurement_po");
    expect(path).toContain("refType=procurement_plan");
    expect(path).toContain("refType=procurement_po_amendment");
    expect(path).toContain("limit=200");
  });
});

describe("ProcurementApprovalsPanel — approval error copy (GAP-PROCUREMENT-APPROVALS-06)", () => {
  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    mockFetchOrQueue.mockReset();
    mockRefresh.mockReset();
    rawPayload = [
      { id: "t1", instanceId: "i1", name: "Approve indent", status: "pending", refType: "procurement_indent", refId: "ind-1" },
    ];
    mockError = null;
  });

  it("shows SoD-specific copy (not the raw body) on a 403 SOD_VIOLATION", async () => {
    mockFetchOrQueue.mockResolvedValue({
      queued: false,
      response: {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ code: "SOD_VIOLATION", message: "maker==checker raw backend text" }),
      },
    });

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    // Dialog opens with its own confirm "Approve"; click the last match.
    const confirmButtons = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(
      await screen.findByText("You raised this request, so a different approver must decide it."),
    ).toBeInTheDocument();
    // Raw backend text never surfaces.
    expect(screen.queryByText(/maker==checker raw backend text/)).not.toBeInTheDocument();
  });

  it("shows catalogued copy (no status, no HTML) on a 500 with an HTML body", async () => {
    mockFetchOrQueue.mockResolvedValue({
      queued: false,
      response: {
        ok: false,
        status: 500,
        text: async () => "<html><body>Internal Server Error 500</body></html>",
      },
    });

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByText(/We couldn't save your approval\./)).toBeInTheDocument();
    expect(screen.queryByText(/Internal Server Error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
  });
});

describe("ProcurementApprovalsPanel -- role gate (GAP-PROCUREMENT-APPROVALS-02)", () => {
  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    rawPayload = [
      { id: "t9", instanceId: "i9", name: "Approve PO 9", status: "pending", roleRef: "procurement_admin", refType: "procurement_po", refId: "po-9" },
      { id: "t10", instanceId: "i10", name: "Open task", status: "pending", roleRef: null, refType: "procurement_po", refId: "po-10" },
    ];
    mockError = null;
  });

  it("shows Approve/Reject only for tasks the viewer's role may complete", () => {
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_clerk"]} />);
    // roleRef-less task is unrestricted server-side; the role-bound one is not.
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getByText("Assigned to procurement_admin")).toBeInTheDocument();
  });

  it("offers every task to super_admin and to the matching role", () => {
    const { unmount } = render(<ProcurementApprovalsPanel viewerRoles={["super_admin"]} />);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
    unmount();
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
  });
});

// ── GAP-PROCUREMENT-APPROVALS-05 / 07 (Wave 2 part 2) ───────────────────────
describe("ProcurementApprovalsPanel — value, requester and amendment link", () => {
  const IND = "11111111-1111-4111-8111-111111111111";
  const AMD = "22222222-2222-4222-8222-222222222222";
  const PO = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    mockFetchOrQueue.mockReset();
    mockRefresh.mockReset();
    mockError = null;
    rawPayload = [
      { id: "t1", instanceId: "i1", name: "Approve indent", status: "pending", roleRef: "procurement_admin", refType: "procurement_indent", refId: IND },
      { id: "t2", instanceId: "i2", name: "Approve amendment", status: "pending", roleRef: "procurement_admin", refType: "procurement_po_amendment", refId: AMD },
    ];
  });

  function stubSummaries(ok = true) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      ok
        ? new Response(JSON.stringify({ data: [
            { refType: "procurement_indent", refId: IND, label: "IND-2026-007", amountMinor: "12345600", requestedBy: "Asha Verma" },
            { refType: "procurement_po_amendment", refId: AMD, label: "PO-2026-004 / Amendment 2", amountMinor: "-25000", poId: PO, requestedBy: "Ravi Iyer" },
          ] }), { status: 200 })
        : new Response(null, { status: 500 }));
  }

  it("APPROVALS-07: shows the document value and requester next to each task (money from minor units)", async () => {
    const spy = stubSummaries();
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    expect(await screen.findByText("₹1,23,456.00")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    // An amendment's value is the signed CHANGE.
    expect(screen.getByText("-₹250.00")).toBeInTheDocument();
    const call = spy.mock.calls[0]!;
    expect(String(call[0])).toBe("/api/proxy/v1/procurement/approvals/ref-summaries");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ refs: [
      { refType: "procurement_indent", refId: IND },
      { refType: "procurement_po_amendment", refId: AMD },
    ] });
  });

  it("APPROVALS-05: the reference shows the readable label and an amendment links to its parent PO", async () => {
    stubSummaries();
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    const amendmentLink = await screen.findByRole("link", { name: "PO-2026-004 / Amendment 2" });
    expect(amendmentLink).toHaveAttribute("href", `/procurement/orders/${PO}`);
    expect(screen.getByRole("link", { name: "IND-2026-007" })).toHaveAttribute("href", `/procurement/indents/${IND}`);
    // No bare UUID is shown for a resolved reference.
    expect(screen.queryByText(AMD)).not.toBeInTheDocument();
  });

  it("APPROVALS-07: the approve dialog restates the value being decided", async () => {
    stubSummaries();
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    await screen.findByText("Asha Verma");
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    expect(await screen.findByText(/Value: ₹1,23,456\.00\./)).toBeInTheDocument();
  });

  it("when the lookup fails the columns show '—' and the failure is reported (not a value of zero)", async () => {
    stubSummaries(false);
    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
    expect(await screen.findByText(/Couldn’t load the value and requester/)).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    // The bare id is the honest fallback; the amendment is plain text (no parent PO known).
    expect(screen.queryByRole("link", { name: AMD })).not.toBeInTheDocument();
  });
});

// ── GAP-PROCUREMENT-APPROVALS-01: server-side filter + paging ───────────────
describe("ProcurementApprovalsPanel — paging through the workflow queue (GAP-PROCUREMENT-APPROVALS-01)", () => {
  const other = (n: number): RawTask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `hr${i}`, instanceId: `ihr${i}`, name: `HR task ${i}`, status: "pending", refType: "leave_app", refId: `leave-${i}`,
    }));
  const procurement = (n: number, from = 0): RawTask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `po${from + i}`, instanceId: `ipo${from + i}`, name: `Approve PO ${from + i}`, status: "pending",
      roleRef: "procurement_admin", refType: "procurement_po", refId: `po-ref-${from + i}`,
    }));

  /** Stubs the tasks GET (returns `nextPage`, or a 500 when null) and the ref-summaries POST. */
  function stubFetch(nextPage: unknown | null) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/ref-summaries")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (nextPage === null) return new Response(null, { status: 500 });
      return new Response(JSON.stringify(nextPage), { status: 200 });
    });
  }

  beforeEach(() => {
    mockUseOfflineResource.mockClear();
    mockFetchOrQueue.mockReset();
    mockRefresh.mockReset();
    rawPayload = [];
    mockError = null;
  });

  it("renders procurement tasks that sit at positions 55-60 of a 60-task page, with no truncation notice", () => {
    rawPayload = { data: [...other(54), ...procurement(6)], pagination: { hasMore: false, total: 60 } };

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    for (let i = 0; i < 6; i += 1) expect(screen.getByText(`Approve PO ${i}`)).toBeInTheDocument();
    expect(screen.queryByText("HR task 0")).not.toBeInTheDocument();
    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    expect(screen.queryByText(/more may exist/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("never shows the 'No pending tasks' all-clear when a full page of other tasks is followed by more pages", () => {
    // The original defect: the first 200 raw tasks hold no procurement task, so the
    // queue used to read "No pending tasks" while procurement approvals sat on page 2.
    rawPayload = { data: other(200), pagination: { hasMore: true, total: 260 } };

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    expect(screen.getByText(/None of the first 200 pending tasks loaded are procurement approvals/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("Load more requests the next page at the right offset and renders the tasks found there", async () => {
    rawPayload = { data: other(200), pagination: { hasMore: true, total: 206 } };
    const spy = stubFetch({ data: procurement(6), pagination: { hasMore: false, total: 206 } });
    try {
      render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(await screen.findByText("Approve PO 0")).toBeInTheDocument();
      expect(screen.getByText("Approve PO 5")).toBeInTheDocument();
      const taskCalls = spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/v1/workflow/tasks"));
      expect(taskCalls).toHaveLength(1);
      expect(taskCalls[0]).toContain("offset=200");
      expect(taskCalls[0]).toContain("status=pending");
      expect(taskCalls[0]).toContain("refType=procurement_po");
      // The server says that was the last page: the notice and the button are gone.
      expect(screen.queryByText(/None of the first/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/more may exist/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps offering Load more while the server reports further pages, counting everything loaded so far", async () => {
    rawPayload = { data: procurement(200), pagination: { hasMore: true, total: 450 } };
    const spy = stubFetch({ data: procurement(200, 200), pagination: { hasMore: true, total: 450 } });
    try {
      render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
      expect(screen.getByText(/Showing the first 200 pending tasks — more may exist/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(await screen.findByText(/Showing the first 400 pending tasks — more may exist/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("trusts the server's pagination envelope over the page length (a full final page is not 'incomplete')", () => {
    rawPayload = { data: procurement(200), pagination: { hasMore: false, total: 200 } };

    render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);

    expect(screen.queryByText(/more may exist/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("reports a failed Load more without dropping the tasks already loaded", async () => {
    rawPayload = { data: [...other(199), ...procurement(1)], pagination: { hasMore: true, total: 250 } };
    const spy = stubFetch(null);
    try {
      render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(await screen.findByText(/Couldn’t load more tasks/)).toBeInTheDocument();
      expect(screen.getByText("Approve PO 0")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
    } finally {
      spy.mockRestore();
    }
  });

  it("stops offering Load more when a page comes back empty even if the server still says hasMore", async () => {
    rawPayload = { data: other(200), pagination: { hasMore: true, total: 999 } };
    const spy = stubFetch({ data: [], pagination: { hasMore: true, total: 999 } });
    try {
      render(<ProcurementApprovalsPanel viewerRoles={["procurement_admin"]} />);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(await screen.findByText("No pending tasks")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});
