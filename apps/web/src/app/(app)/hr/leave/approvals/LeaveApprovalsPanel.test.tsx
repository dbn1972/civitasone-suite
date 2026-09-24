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
    if (url.endsWith("/workflow/comments")) return { ok: true, status: 202, text: async () => "{}" } as Response;
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

describe("LeaveApprovalsPanel — reason persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records the rejection reason as a comment, since workflow-service's complete endpoint silently drops it", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText(/reason for rejection/i), { target: { value: "Insufficient staffing on those dates" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject leave" }));

    await waitFor(() => {
      const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
      expect(calls.some((c) => c.url.endsWith("/workflow/comments"))).toBe(true);
    });

    const calls = (fetchMock as unknown as { calls: { url: string; body: unknown }[] }).calls;
    const completeCall = calls.find((c) => c.url.endsWith("/complete"));
    const commentCall = calls.find((c) => c.url.endsWith("/workflow/comments"));

    // completeTaskBody on the backend only accepts {decision} — sending more is harmless
    // but the reason must not be relied upon to reach the server through this call.
    expect(completeCall?.body).toEqual({ decision: "reject" });
    expect(commentCall?.body).toMatchObject({
      entityType: "leave_app",
      entityId: "leave-1",
      body: expect.stringContaining("Insufficient staffing on those dates"),
    });
  });

  it("still completes the decision even if saving the reason comment fails, but says so honestly", async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes("/workflow/tasks?")) return { ok: true, status: 200, json: async () => ({ data: [TASK] }) } as Response;
      if (url.includes("/hrms/leave-requests")) return { ok: true, status: 200, json: async () => ({ data: [LEAVE] }) } as Response;
      if (url.endsWith("/complete")) return { ok: true, status: 202, text: async () => "{}" } as Response;
      if (url.endsWith("/workflow/comments")) return { ok: false, status: 500, text: async () => "boom" } as Response;
      return { ok: false, status: 404, text: async () => "{}" } as Response;
    });
    vi.stubGlobal("fetch", fn);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve leave" }));

    await waitFor(() => {
      expect(screen.getByText(/reason could not be saved/i)).toBeInTheDocument();
    });
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
    await waitFor(() => expect(screen.getByText(/couldn't load this leave application/i)).toBeInTheDocument());
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

    const el = await screen.findByText(/couldn't load this leave application/i, {}, { timeout: 3000 });
    expect(el).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
  });
});
