import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DecideActions } from "./DecideActions";

const base = {
  decideUrl: "v1/revenue/instalments/p1/decide",
  noun: "instalment plan",
  status: "pending",
  makerUserId: "maker-1",
  currentUserId: "checker-1",
  summary: "a plan of ₹12,000.00",
};

describe("DecideActions (maker-checker decide control)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows Approve and Reject for a pending item raised by someone else", () => {
    render(<DecideActions {...base} />);
    expect(screen.getByRole("button", { name: "Approve instalment plan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject instalment plan" })).toBeEnabled();
  });

  it("disables both and says a different officer must decide when the viewer is the maker", () => {
    render(<DecideActions {...base} currentUserId="maker-1" />);
    expect(screen.getByRole("button", { name: "Approve instalment plan" })).toBeDisabled();
    expect(screen.getByText(/different officer must decide/i)).toBeInTheDocument();
  });

  it("shows no live buttons once the item is decided", () => {
    render(<DecideActions {...base} status="active" />);
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("approves through PATCH decideUrl with { approve: true } and refreshes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { messageId: "m1" } }), { status: 202 }));
    render(<DecideActions {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve instalment plan" }));
    await waitFor(() => expect(screen.getByText("Approve this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve instalment plan", { selector: "button:not([aria-label])" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("v1/revenue/instalments/p1/decide");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ approve: true });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("requires a reason to reject", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    render(<DecideActions {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject instalment plan" }));
    await waitFor(() => expect(screen.getByText("Reject this instalment plan?")).toBeInTheDocument());
    expect(screen.getByLabelText(/Reason for rejection/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error, never the raw server code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "the maker cannot decide it" } }), { status: 409 }),
    );
    render(<DecideActions {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve instalment plan" }));
    await waitFor(() => expect(screen.getByText("Approve this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve instalment plan", { selector: "button:not([aria-label])" }));
    await waitFor(() => expect(document.querySelector("[role=alertdialog] [role=alert]")).not.toBeNull());
    expect(screen.queryByText(/MAKER_CHECKER_VIOLATION/)).not.toBeInTheDocument();
  });
});
