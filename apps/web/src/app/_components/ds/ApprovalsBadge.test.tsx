import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@/test-utils/intl-render";
import { ApprovalsBadge } from "./ApprovalsBadge";
import { COUNTS_EVENT } from "@/app/(app)/approvals/_lib/inboxModel";

describe("ApprovalsBadge (UX R1: sidebar count = inbox Waiting tab)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; window.sessionStorage.clear(); });

  it("shows the waiting count from /inbox/counts, then follows the inbox counts event", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: { waiting: 18, overdue: 3, sent: 2, done: 9 } }), { status: 200 })) as unknown as typeof fetch;
    render(<ApprovalsBadge />);
    await waitFor(() => expect(screen.getByTestId("approvals-badge")).toHaveTextContent("18"));
    expect(screen.getByText("18 items waiting for you")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/proxy/v1/workflow/inbox/counts", expect.anything());
    act(() => { window.dispatchEvent(new CustomEvent(COUNTS_EVENT, { detail: { waiting: 17, overdue: 3, sent: 2, done: 10 } })); });
    expect(screen.getByTestId("approvals-badge")).toHaveTextContent("17");
  });

  it("renders nothing when nothing is waiting or the count cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const { container } = render(<ApprovalsBadge />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
