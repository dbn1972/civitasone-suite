import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";

const TASK = { id: "task-1", instanceId: "inst-1", name: "Leave approval", status: "pending", refType: "leave_app", refId: "leave-1" };
const LEAVE = { id: "leave-1", employeeName: "Asha Verma", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", days: 2, reason: "Family function" };

// UX-017 (tranche 2): LeaveApprovalsPanel now reads its copy through
// next-intl (useTranslations("leaveApprovals")), so it needs a real provider
// in the tree — same pattern as citizen/grievances/GrievancesTable.test.tsx.
function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveApprovalsPanel />
    </NextIntlClientProvider>,
  );
}

function mockFetch() {
  const calls: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK] }) } as Response;
    if (url.includes("/hrms/leave-requests")) return { ok: true, status: 200, json: async () => ({ data: [LEAVE] }) } as Response;
    if (url.endsWith("/complete")) return { ok: true, status: 202, text: async () => "{}" } as Response;
    return { ok: false, status: 404, text: async () => "{}" } as Response;
  });
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

// Mount-time fetch cancellation: the initial load used to have no
// AbortController at all, so a fetch that resolved after this panel had
// already unmounted (the user navigated away while it was still loading)
// would still run its .then()/.catch() and call setState on a gone
// component.
describe("LeaveApprovalsPanel — cancels its initial load on unmount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("aborts the in-flight initial-load requests when the panel unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/workflow/tasks?")) {
        capturedSignal = init?.signal ?? undefined;
        // Never resolves -- simulates a request still in flight when the
        // user navigates away, so unmount is what has to end it.
        return new Promise<Response>(() => {});
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fn);

    const { unmount } = renderPanel();
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("LeaveApprovalsPanel — reason persistence (GAP-HR-LEAVE-APPROVALS-03)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the rejection reason in the single atomic complete call and never posts a separate comment", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText(/reason for rejection/i), { target: { value: "Insufficient staffing on those dates" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject leave" }));

    await waitFor(() => {
      const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
      expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(true);
    });

    const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
    const completeCalls = calls.filter((c) => c.url.endsWith("/complete"));
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.body).toEqual({ decision: "reject", reason: "Insufficient staffing on those dates" });
    expect(calls.some((c) => c.url.includes("/workflow/comments"))).toBe(false);
  });

  it("sends an approve remark in the same complete call, and omits reason when blank", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve leave" }));

    await waitFor(() => {
      const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
      expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(true);
    });
    const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
    expect(calls.find((c) => c.url.endsWith("/complete"))?.body).toEqual({ decision: "approve", reason: "Looks fine" });
  });

  it("keeps the dialog open with an error and no success toast when the single complete call fails", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK] }) } as Response;
      if (url.includes("/hrms/leave-requests")) return { ok: true, status: 200, json: async () => ({ data: [LEAVE] }) } as Response;
      if (url.endsWith("/complete")) return { ok: false, status: 500, text: async () => "boom" } as Response;
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText(/reason for rejection/i), { target: { value: "No cover" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject leave" }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    expect(screen.queryByText(/Leave rejected\./)).not.toBeInTheDocument();
  });
});

/**
 * UX-016: both the task-list load and a decision (approve/reject) used to
 * JSON-parse the response and fall back to the raw response text verbatim
 * (or `${decision} failed (${res.status})`) — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("LeaveApprovalsPanel — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw server text, when the task list fails to load", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/workflow/tasks")) {
        return Promise.resolve(new Response("workflow-service: db pool exhausted", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    // renderPanel(), not a bare render(): LeaveApprovalsPanel calls
    // useTranslations() (UX-017) and needs a NextIntlClientProvider ancestor.
    renderPanel();

    // Scoped to the toHumanError "area" text (not just /couldn't load/i)
    // since this panel's own DataSourceBadge also shows a generic
    // "Couldn't load — showing nothing" pill on this same error state.
    await waitFor(() => expect(screen.getByText(/couldn't load leave application/i)).toBeInTheDocument());
    expect(screen.queryByText(/workflow-service/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw server text, when a decision fails", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      // Check the more specific "/complete" suffix before the broader
      // "/workflow/tasks" substring check below — the complete URL
      // (".../workflow/tasks/task-1/complete") itself contains
      // "/workflow/tasks", so the order here matters.
      if (typeof url === "string" && url.endsWith("/complete")) {
        return Promise.resolve(new Response("workflow-service: complete route panicked", { status: 500 }));
      }
      if (typeof url === "string" && url.includes("/workflow/tasks")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [TASK] }), { status: 200 }));
      }
      if (typeof url === "string" && url.includes("/hrms/leave-requests")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [LEAVE] }), { status: 200 }));
      }
      return Promise.resolve(new Response("workflow-service: complete route panicked", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve leave/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/workflow-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});

// UX-016 tranche 8 — this file was tranche 2's own settled-outlier: it kept
// reading a caught exception's own `.message` on the load path (fixed here),
// while tranche 7 established the fleet-wide rule never to (see
// docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-016 tranche 7). Neither
// existing describe block above exercised a genuine network exception (as
// opposed to an ok:false HTTP response) on the *load* path, so the previous
// leak had no regression coverage at all.
describe("LeaveApprovalsPanel — network failure on load (UX-016)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message on a genuine network failure, never the raw browser exception text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderPanel();

    const el = await screen.findByText(/couldn't load leave application/i, {}, { timeout: 3000 });
    expect(el).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-SF-16 item 4: scoping GET /leave-requests server-side means a
 * second-level/delegated approver outside the applicant's direct reporting
 * line will now legitimately get a task with no matching leave detail (not
 * just on a hard fetch failure). Before this fix, "Unknown employee" was
 * shown but Approve/Reject stayed fully clickable — a blind-approval risk.
 * This must be disabled per-row, not panel-wide: a row WITH real data must
 * stay actionable even when a sibling row's data is missing.
 */
describe("LeaveApprovalsPanel — fail-open containment (GAP-HR-SF-16 item 4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const TASK_OK = { id: "task-ok", instanceId: "inst-ok", name: "Leave approval", status: "pending", refType: "leave_app", refId: "leave-ok" };
  const TASK_MISSING = { id: "task-missing", instanceId: "inst-missing", name: "Leave approval", status: "pending", refType: "leave_app", refId: "leave-missing" };
  const LEAVE_OK = { id: "leave-ok", employeeName: "Asha Verma", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", days: 2, reason: "Family function" };

  it("disables Approve/Reject only for the row whose leave detail is missing from an otherwise-successful response", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK_OK, TASK_MISSING] }) } as Response;
      // leave-missing is legitimately absent (e.g. scoped out for this
      // approver by the backend read-scoping fix) -- not a fetch failure.
      if (url.includes("/hrms/leave-requests")) return { ok: true, status: 200, json: async () => ({ data: [LEAVE_OK] }) } as Response;
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    const okRow = (await screen.findByText("Asha Verma")).closest("tr");
    const missingRow = (await screen.findByText("Unknown employee")).closest("tr");
    if (!okRow || !missingRow) throw new Error("expected both rows to render");

    expect(within(okRow).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(within(okRow).getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(within(missingRow).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(missingRow).getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("disables Approve/Reject for every row when the whole enrichment fetch fails outright", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK_OK] }) } as Response;
      if (url.includes("/hrms/leave-requests")) throw new TypeError("Failed to fetch");
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    const row = (await screen.findByText("Unknown employee")).closest("tr");
    if (!row) throw new Error("expected the task row to render");
    expect(within(row).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  // GAP-HR-LEAVE-APPROVALS-01: the enrichment failure must be visible on its
  // own terms, not just inferred from every row silently showing "Unknown
  // employee" with no explanation and no way to retry just that part.
  it("shows a distinct, retryable banner when only the enrichment fetch fails (tasks themselves loaded fine)", async () => {
    let leaveCallCount = 0;
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK_OK] }) } as Response;
      if (url.includes("/hrms/leave-requests")) {
        leaveCallCount++;
        if (leaveCallCount === 1) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => ({ data: [LEAVE_OK] }) } as Response;
      }
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    const banner = await screen.findByRole("alert"); // the enrichError banner — no other alert-role element exists at this point
    expect(banner).toHaveTextContent(/employee details couldn't be loaded/i);
    // The task itself is NOT reported as failed — this is a distinct concern.
    expect(screen.queryByText("Could not load approvals")).not.toBeInTheDocument();

    fireEvent.click(within(banner).getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("Asha Verma")).toBeInTheDocument());
    expect(screen.queryByText(/employee details couldn't be loaded/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-LEAVE-APPROVALS-04: the panel now asks for exactly the
 * applications its own visible tasks reference, instead of its entire
 * tenant/manager-scoped page.
 */
describe("LeaveApprovalsPanel — scoped enrichment request (GAP-HR-LEAVE-APPROVALS-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests refType=leave_app on the tasks call and ids=<visible refIds> on the enrichment call", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText("Asha Verma");

    const calls = (fetchMock as unknown as { calls: { url: string }[] }).calls;
    expect(calls.some((c) => c.url.includes("/workflow/tasks?") && c.url.includes("refType=leave_app"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/hrms/leave-requests?ids=leave-1"))).toBe(true);
  });

  it("makes no enrichment call at all when there are no pending leave tasks", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    await screen.findByText(/no pending approvals/i);
    expect(fn.mock.calls.some(([u]) => typeof u === "string" && u.includes("/hrms/leave-requests"))).toBe(false);
  });
});

/**
 * GAP-HR-LEAVE-APPROVALS-06: a decided row disappears immediately, without
 * waiting on a full task-list refetch — and the (redundant) tenant-wide
 * /leave-requests re-fetch after every decision is gone.
 */
describe("LeaveApprovalsPanel — optimistic decision (GAP-HR-LEAVE-APPROVALS-06)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes the decided row before any refetch resolves, and does not re-request /leave-requests after the decision", async () => {
    let tasksCallCount = 0;
    let leaveCallCount = 0;
    let resolveComplete: (() => void) | undefined;
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) {
        tasksCallCount++;
        return { ok: true, status: 200, json: async () => ({ data: tasksCallCount === 1 ? [TASK] : [] }) } as Response;
      }
      if (url.includes("/hrms/leave-requests")) {
        leaveCallCount++;
        return { ok: true, status: 200, json: async () => ({ data: [LEAVE] }) } as Response;
      }
      if (url.endsWith("/complete")) {
        return new Promise<Response>((resolve) => {
          resolveComplete = () => resolve({ ok: true, status: 202, text: async () => "{}" } as Response);
        });
      }
      return { ok: true, status: 202, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve leave" }));
    await waitFor(() => expect(resolveComplete).toBeDefined());
    const leaveCallsBeforeResolve = leaveCallCount;
    resolveComplete!();

    await waitFor(() => expect(screen.queryByText("Asha Verma")).not.toBeInTheDocument());
    // The background re-sync only re-requests /workflow/tasks — not another
    // /leave-requests round trip (no new task appeared needing enrichment).
    expect(leaveCallCount).toBe(leaveCallsBeforeResolve);
  });
});
