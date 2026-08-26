import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
let rawPayload: RawTask[] = [];
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

    render(<ProcurementApprovalsPanel />);

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

    render(<ProcurementApprovalsPanel />);

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

    render(<ProcurementApprovalsPanel />);

    expect(screen.getByText("No pending tasks")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated HR task")).not.toBeInTheDocument();
    expect(screen.queryByText("Already-completed indent approval")).not.toBeInTheDocument();
  });

  it("still shows procurement_indent and procurement_po tasks (no regression on the original two types)", () => {
    rawPayload = [
      { id: "t5", instanceId: "i5", name: "Approve indent", status: "pending", refType: "procurement_indent", refId: "ind-1" },
      { id: "t6", instanceId: "i6", name: "Approve PO", status: "pending", refType: "procurement_po", refId: "po-1" },
    ];

    render(<ProcurementApprovalsPanel />);

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

    render(<ProcurementApprovalsPanel />);

    expect(screen.queryByText("No pending tasks")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t (load|check)/i);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
