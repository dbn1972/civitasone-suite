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
  id: FILE_ID, fileNo: "EST/2026/88", subject: "Transfer of Shri X", classification: "public",
  noteSheets: [
    { id: "n1", author: "Asha Rao", content: "Initial proposal.", timestamp: "2026-10-01T09:00:00.000Z", noteStatus: "approved" },
    { id: "n2", author: "Vikram Sen", content: "Recommended for approval as per the transfer policy of 2024.\n\nPlease sanction.", timestamp: "2026-10-03T10:30:00.000Z", noteStatus: "submitted" },
  ],
};

type Handlers = {
  /** Successive answers for GET /workflow/tasks?instanceId=… (the last one repeats). */
  instanceTasks?: unknown[][];
  fileDto?: unknown;
  /** The pending queue; defaults to the one task of FILE_ID. */
  tasks?: unknown[];
  /** File DTOs by file id, for queues of more than one file. */
  fileDtos?: Record<string, unknown>;
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
      return Promise.resolve(jsonResponse({ data: pendingReads === 1 ? (h.tasks ?? [task()]) : [], pagination: { hasMore: false } }));
    }
    if (url.includes("/complete") && method === "POST") return Promise.resolve(jsonResponse({ id: TASK_ID, status: "accepted" }, 202));
    if (url.includes("/v1/estab/files/")) {
      const id = decodeURIComponent(url.split("/v1/estab/files/")[1] ?? "");
      const dto = h.fileDtos?.[id] ?? (id === FILE_ID ? (h.fileDto ?? FILE_DTO) : undefined);
      return Promise.resolve(dto ? jsonResponse(dto) : jsonResponse({}, 404));
    }
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
    const link = screen.getByRole("link", { name: "Open note in a new tab, file EST/2026/88" });
    expect(link).toHaveAttribute("href", `/estab/files/${FILE_ID}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("says no note is available (and still shows the file) when the file has none or cannot be read", async () => {
    installFetch({ fileDto: { id: FILE_ID, fileNo: "EST/2026/89", subject: "No notes yet", classification: "public", noteSheets: [] } });
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("EST/2026/89")).toBeInTheDocument();
    expect(screen.getByText("No note available")).toBeInTheDocument();
  });
});

describe("EstabApprovalsPanel — note links are distinguishable per file (GAP-ESTAB-APPROVALS-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("gives each row's 'Open note in a new tab' link a name that includes its file number", async () => {
    const OTHER_ID = "99999999-9999-4999-8999-999999999999";
    installFetch({
      tasks: [task(), task({ id: "t-2", refId: OTHER_ID })],
      fileDtos: {
        [FILE_ID]: FILE_DTO,
        [OTHER_ID]: { id: OTHER_ID, fileNo: "EST/2026/91", subject: "Posting order", classification: "public", noteSheets: [] },
      },
    });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/91");
    const links = screen.getAllByRole("link", { name: /^Open note in a new tab/ });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Open note in a new tab, file EST/2026/88",
      "Open note in a new tab, file EST/2026/91",
    ]);
  });
});

describe("EstabApprovalsPanel — secret and top-secret files stay masked, as in the register (GAP-ESTAB-APPROVALS-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const classified = (classification: unknown) => ({
    id: FILE_ID, fileNo: "EST/2026/90", subject: "Sensitive posting of Shri Y", classification,
    noteSheets: [{ id: "n9", author: "Meera Das", content: "Cabinet-level detail that must not be listed.", timestamp: "2026-10-05T09:00:00.000Z", noteStatus: "submitted" }],
  });

  it.each(["top_secret", "secret"])("Given a %s file, Then the row shows its number and '[Classified]' but not the subject, note text or author", async (level) => {
    installFetch({ fileDto: classified(level) });
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("EST/2026/90")).toBeInTheDocument();
    expect(screen.getByText("[Classified]")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Sensitive posting of Shri Y");
    expect(text).not.toContain("Cabinet-level detail");
    expect(text).not.toContain("Meera Das");
    expect(screen.getByText("The note of a classified file is not shown here. Open the file to read it.")).toBeInTheDocument();
    // the approver can still open the file in a new tab to read it
    const link = screen.getByRole("link", { name: "Open note in a new tab, file EST/2026/90" });
    expect(link).toHaveAttribute("href", `/estab/files/${FILE_ID}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("Given a top-secret file, Then the approve dialog names the file as classified and quotes no note", async () => {
    installFetch({ fileDto: classified("top_secret") });
    render(<EstabApprovalsPanel />);
    await screen.findByText("EST/2026/90");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Approve file EST\/2026\/90 — \[Classified\]\?/);
    expect(dialog.textContent).toMatch(/The note of a classified file is not shown here/);
    expect(dialog.textContent).not.toContain("Sensitive posting of Shri Y");
    expect(dialog.textContent).not.toContain("Cabinet-level detail");
    expect(dialog.textContent).not.toMatch(/Latest note on this file:/);
  });

  it("Given a confidential file, Then it is listed with its subject and note, as in the register", async () => {
    installFetch({ fileDto: classified("confidential") });
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("Sensitive posting of Shri Y")).toBeInTheDocument();
    expect(screen.getByText(/Cabinet-level detail that must not be listed\./)).toBeInTheDocument();
    expect(screen.queryByText("[Classified]")).not.toBeInTheDocument();
  });

  it("Given a file DTO with no classification, Then it fails closed: the subject and note are not shown", async () => {
    installFetch({ fileDto: classified(undefined) });
    render(<EstabApprovalsPanel />);
    expect(await screen.findByText("EST/2026/90")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Sensitive posting of Shri Y");
    expect(document.body.textContent).not.toContain("Cabinet-level detail");
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
