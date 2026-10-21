/**
 * Approver context and outcome (GAP-ESTAB-APPROVALS-03 / -05).
 *
 * The fetch mock here answers by URL + method (not by call order) and returns what the real services
 * return: GET /v1/estab/files/:id is a BARE file DTO (no { data } envelope) carrying note sheets, and
 * GET /v1/workflow/tasks?instanceId= lists every task of the instance whatever its role.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { EstabApprovalsPanel } from "./EstabApprovalsPanel";

const FILE_ID = "66666666-6666-4666-8666-666666666666";
const INSTANCE_ID = "77777777-7777-4777-8777-777777777777";
const TASK_ID = "88888888-8888-4888-8888-888888888888";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID, name: "Section review", status: "pending", refType: "estab_file", refId: FILE_ID,
    roleRef: "estab_under_secretary", instanceId: INSTANCE_ID, ...overrides,
  };
}

const FILE_DTO = {
  id: FILE_ID, fileNo: "EST/2026/88", subject: "Transfer of Shri X",
  noteSheets: [
    { id: "n1", author: "Asha Rao", content: "Initial proposal.", timestamp: "2026-10-01T09:00:00.000Z", noteStatus: "approved" },
    { id: "n2", author: "Vikram Sen", content: "Recommended for approval as per the transfer policy of 2024.\n\nPlease sanction.", timestamp: "2026-10-03T10:30:00.000Z", noteStatus: "submitted" },
  ],
};

type Handlers = {
  /** Successive answers for GET /workflow/tasks?instanceId=… (the last one repeats). */
  instanceTasks?: unknown[][];
  fileDto?: unknown;
};

function installFetch(h: Handlers = {}) {
  let pendingReads = 0;
  let instanceCalls = 0;
  const calls: Array<{ url: string; method: string }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/v1/workflow/tasks?instanceId=")) {
      const seq = h.instanceTasks ?? [[]];
      const answer = seq[Math.min(instanceCalls, seq.length - 1)] ?? [];
      instanceCalls += 1;
      return Promise.resolve(jsonResponse({ data: answer }));
    }
    if (url.includes("/v1/workflow/tasks?status=pending")) {
      pendingReads += 1;
      // the queue holds the task until it has been approved, then it is empty
      return Promise.resolve(jsonResponse({ data: pendingReads === 1 ? [task()] : [], pagination: { hasMore: false } }));
    }
    if (url.includes("/complete") && method === "POST") return Promise.resolve(jsonResponse({ id: TASK_ID, status: "accepted" }, 202));
    if (url.includes(`/v1/estab/files/${FILE_ID}`)) return Promise.resolve(jsonResponse(h.fileDto ?? FILE_DTO));
    return Promise.resolve(jsonResponse({}, 404));
  });
  return { calls, instanceCalls: () => instanceCalls };
}

/** Advance the fake clock inside act(), so the state updates the polls cause are flushed. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function approve() {
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  const dialog = await screen.findByRole("alertdialog");
  const reason = dialog.querySelector("textarea") ?? dialog.querySelector("input");
  fireEvent.change(reason!, { target: { value: "Approved as per policy" } });
  const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve");
  fireEvent.click(confirm!);
}

describe("EstabApprovalsPanel — file context from the real (bare) file DTO (GAP-ESTAB-APPROVALS-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the file number and subject, never a UUID slice, when the file comes back as a bare object", async () => {
    installFetch();
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("EST/2026/88")).toBeInTheDocument();
    expect(screen.getByText("Transfer of Shri X")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("66666666…");
  });

  it("shows the LATEST note (by timestamp) with its author in the row, collapsed to one line", async () => {
    installFetch();
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    expect(screen.getByText(/Recommended for approval as per the transfer policy of 2024\. Please sanction\./)).toBeInTheDocument();
    expect(screen.queryByText(/Initial proposal/)).not.toBeInTheDocument();
    expect(screen.getByText(/Vikram Sen/)).toBeInTheDocument();
  });

  it("names the file and quotes the latest note in the approve dialog", async () => {
    installFetch();
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Approve file EST\/2026\/88 — Transfer of Shri X\?/);
    expect(dialog.textContent).toMatch(/Latest note on this file:/);
    expect(dialog.textContent).toMatch(/Recommended for approval as per the transfer policy of 2024\./);
  });

  it("offers an 'Open note in a new tab' link per row that cannot hijack the opener", async () => {
    installFetch();
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    const link = screen.getByRole("link", { name: "Open note in a new tab" });
    expect(link).toHaveAttribute("href", `/estab/files/${FILE_ID}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("says no note is available (and still shows the file) when the file has none or cannot be read", async () => {
    installFetch({ fileDto: { id: FILE_ID, fileNo: "EST/2026/89", subject: "No notes yet", noteSheets: [] } });
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("EST/2026/89")).toBeInTheDocument();
    expect(screen.getByText("No note available")).toBeInTheDocument();
  });
});

describe("EstabApprovalsPanel — outcome comes from the workflow, not from role names (GAP-ESTAB-APPROVALS-05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  const own = (status: string, roleRef = "estab_under_secretary") => task({ status, roleRef });

  it("Given no other step is pending once the task completed, Then it says 'Final approval' (and not 'forwarded')", async () => {
    installFetch({ instanceTasks: [[own("pending")], [own("completed")]] });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    await approve();
    // Straight after the 202 the message only says what is known.
    expect(await screen.findByText(/Approval recorded for file EST\/2026\/88\. Checking where the noting goes next/)).toBeInTheDocument();
    expect(screen.queryByText(/Final approval/)).not.toBeInTheDocument();
    await tick(1000); // poll 1: the task is not completed yet
    expect(screen.queryByText(/Final approval/)).not.toBeInTheDocument();
    await tick(1000); // poll 2: completed, nothing else pending
    expect(await screen.findByText(/Final approval recorded for file EST\/2026\/88\. No further approval step is pending\./)).toBeInTheDocument();
    expect(screen.queryByText(/forwarded/i)).not.toBeInTheDocument();
  });

  it("Given another step is pending, Then it says the noting was forwarded to that role", async () => {
    installFetch({ instanceTasks: [[own("completed"), task({ id: "next-task", status: "pending", roleRef: "estab_deputy_secretary" })]] });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    await approve();
    await tick(1000);
    expect(await screen.findByText(/forwarded to Deputy Secretary for the next approval/)).toBeInTheDocument();
    expect(screen.queryByText(/Final approval/)).not.toBeInTheDocument();
  });

  it("Given a renamed role and task name, Then the same workflow state gives the same message", async () => {
    const renamed = (status: string) => task({ status, name: "Totally different title", roleRef: "estab_renamed_role_x" });
    installFetch({ instanceTasks: [[renamed("completed")]] });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    await approve();
    await tick(1000);
    expect(await screen.findByText(/Final approval recorded for file EST\/2026\/88/)).toBeInTheDocument();
  });

  it("Given the workflow never shows the task completed, Then after the polls it says it is not applied yet and claims neither outcome", async () => {
    const h = installFetch({ instanceTasks: [[own("pending")]] });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    await approve();
    for (let i = 0; i < 5; i += 1) await tick(1000);
    expect(await screen.findByText(/the workflow has not applied it yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Final approval/)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been forwarded/)).not.toBeInTheDocument();
    expect(h.instanceCalls()).toBe(5);
    await tick(10_000);
    expect(h.instanceCalls()).toBe(5); // bounded: it stops
  });

  it("stops polling when the page is closed", async () => {
    const h = installFetch({ instanceTasks: [[own("pending")]] });
    const { unmount } = render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    await approve();
    await tick(1000);
    const seen = h.instanceCalls();
    unmount();
    await tick(10_000);
    expect(h.instanceCalls()).toBe(seen);
  });

  it("a rejection keeps its own message and does not poll", async () => {
    const h = installFetch();
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/88");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Needs revision" } });
    fireEvent.click(within(dialog).getAllByRole("button").find((b) => b.textContent === "Reject")!);
    await waitFor(() => expect(screen.getByText(/Rejection recorded for file EST\/2026\/88/)).toBeInTheDocument());
    await tick(5000);
    expect(h.instanceCalls()).toBe(0);
  });
});
