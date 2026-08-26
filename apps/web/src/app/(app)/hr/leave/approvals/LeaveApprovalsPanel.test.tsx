import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";

const TASK = { id: "task-1", instanceId: "inst-1", name: "Leave approval", status: "pending", refType: "leave_app", refId: "leave-1" };
const LEAVE = { id: "leave-1", employeeName: "Asha Verma", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", days: 2, reason: "Family function" };

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

describe("LeaveApprovalsPanel — reason persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records the rejection reason as a comment, since workflow-service's complete endpoint silently drops it", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<LeaveApprovalsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
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
    render(<LeaveApprovalsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText(/approval remarks/i), { target: { value: "Looks fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve leave" }));

    await waitFor(() => {
      expect(screen.getByText(/reason could not be saved/i)).toBeInTheDocument();
    });
  });
});
