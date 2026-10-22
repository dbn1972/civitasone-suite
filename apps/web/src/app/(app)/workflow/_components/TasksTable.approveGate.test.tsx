import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@/test-utils/intl-render";
import { TasksTable } from "./TasksTable";
import type { WorkflowTask } from "../_data/workflowTypes";

/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-02 (w0-report F4) — Approve is disabled, with a
 * visible reason, while the lane document checklist is loading, failed to load,
 * or has missing mandatory documents. Return / Reject stay available.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workflow/my-tasks",
}));

const ME = "11111111-1111-1111-1111-111111111111";

function appTask(appId: string): WorkflowTask {
  return {
    id: `task-${appId.slice(0, 4)}`,
    instanceId: "inst-1",
    name: "Inspection",
    status: "pending",
    roleRef: null,
    nodeKey: "inspection",
    refType: "application",
    refId: appId,
    decision: null,
    assigneeId: ME,
    createdAt: "2026-01-10T09:00:00.000Z",
    dueAt: null,
    version: 1,
  };
}

/** Answers the batched POST /verification-lane/batch the checklist now uses: every requested lane gets `items`. */
function checklistAnswer(items: Array<{ docType: string; mandatory: boolean; provided: boolean }>) {
  return async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const lanes = (JSON.parse(String(init?.body)) as { lanes: Array<{ laneKey: string; serviceId?: string; applicationId?: string }> }).lanes;
    return new Response(JSON.stringify({
      data: lanes.map((l) => ({
        laneKey: l.laneKey, serviceId: l.serviceId ?? null, applicationId: l.applicationId ?? null, ok: true,
        items: items.map((i) => ({ ...i, verified: false })),
      })),
    }), { status: 200 });
  };
}

describe("TasksTable Approve gating — GAP-WORKFLOW-INSTANCES-DETAIL-02", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("disables Approve with a visible reason while the checklist is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise<Response>(() => {}));
    render(<TasksTable tasks={[appTask("aaaa0001-0000-0000-0000-000000000001")]} currentUserId={ME} showStatusFilter={false} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/Checking the required documents/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("disables Approve with a visible reason when the checklist failed to load, and re-enables after a successful Retry", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockImplementation(checklistAnswer([{ docType: "id", mandatory: true, provided: true }]));
    render(<TasksTable tasks={[appTask("aaaa0002-0000-0000-0000-000000000002")]} currentUserId={ME} showStatusFilter={false} />);
    await waitFor(() => expect(screen.getByText(/checklist could not be loaded/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry document checklist" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disables Approve with a visible reason when mandatory documents are missing", async () => {
    vi.spyOn(global, "fetch").mockImplementation(checklistAnswer([
      { docType: "id", mandatory: true, provided: false },
      { docType: "addr", mandatory: true, provided: false },
      { docType: "photo", mandatory: false, provided: false },
    ]));
    render(<TasksTable tasks={[appTask("aaaa0003-0000-0000-0000-000000000003")]} currentUserId={ME} showStatusFilter={false} />);
    await waitFor(() => expect(screen.getByText(/2 mandatory document\(s\) missing/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAccessibleDescription(/mandatory document\(s\) missing/);
    expect(screen.getByRole("button", { name: "Return" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("keeps Approve enabled when every mandatory document is provided", async () => {
    vi.spyOn(global, "fetch").mockImplementation(checklistAnswer([
      { docType: "id", mandatory: true, provided: true },
      { docType: "photo", mandatory: false, provided: false },
    ]));
    render(<TasksTable tasks={[appTask("aaaa0004-0000-0000-0000-000000000004")]} currentUserId={ME} showStatusFilter={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(screen.queryByText(/mandatory document\(s\) missing/)).not.toBeInTheDocument();
  });

  it("does not gate tasks that have no document checklist (non-application tasks)", () => {
    const fetchMock = vi.spyOn(global, "fetch");
    render(<TasksTable tasks={[{ ...appTask("aaaa0005-0000-0000-0000-000000000005"), refType: "leave_app" }]} currentUserId={ME} showStatusFilter={false} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
