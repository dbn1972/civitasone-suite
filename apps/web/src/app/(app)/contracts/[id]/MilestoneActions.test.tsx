import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { MilestoneActions } from "./MilestoneActions";

describe("MilestoneActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does not PATCH until the confirmation dialog is accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    // Clicking the row action only opens the confirm dialog — it must not
    // fire the request on its own (this is a terminal, unrepeatable action).
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, mark complete" }));
    await waitFor(() => expect(screen.getByText(/request received/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0][0]).toContain("/milestones/m1/complete");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("cancelling the confirm dialog fires no request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marking late requires a reason and sends it as notes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark late" }));
    const confirmBtn = screen.getByRole("button", { name: "Yes, mark late" });
    // No reason entered yet — the dialog must not allow confirming.
    expect(confirmBtn).toBeDisabled();

    const reasonBox = screen.getByLabelText(/reason for the delay/i);
    fireEvent.change(reasonBox, { target: { value: "Vendor delayed material delivery by 2 weeks" } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/request received/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0][0]).toContain("/milestones/m1/late");
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.notes).toBe("Vendor delayed material delivery by 2 weeks");
  });

  it("shows the due date next to each milestone action (GAP-CONTRACTS-DETAIL-05)", () => {
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending", dueDate: "2026-09-01" }]}
      />,
    );
    // formatIndianDate("2026-09-01") -> "01 Sep 2026".
    expect(screen.getByText(/due 01 Sep 2026/)).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-DETAIL-06: shows a Pending pill after 202 and offers a manual Refresh (no timer-based refresh, SF-15)", async () => {
    // SF-15: a fixed timer + router.refresh() only guesses the write landed, so
    // none must be scheduled; the user gets an honest "received" notice with a
    // manual Refresh instead. (Spy rather than fake timers, which deadlock
    // waitFor's own polling.)
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, mark complete" }));
    // Wait for fetch to resolve and state to update.
    await waitFor(() => expect(screen.getByText(/request received/i)).toBeInTheDocument());
    // The Pending pill must appear immediately after the 202.
    expect(screen.getByLabelText("Status update pending")).toBeInTheDocument();
    // The message must not claim the action completed.
    expect(screen.queryByText(/marked complete/i)).not.toBeInTheDocument();
    // Immediate router.refresh() was called once.
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // No 5 s / 10 s follow-up refresh timers are scheduled.
    const pollDelays = setTimeoutSpy.mock.calls
      .filter(([, d]) => typeof d === "number" && (d === 5_000 || d === 10_000))
      .map(([, d]) => d);
    expect(pollDelays).toEqual([]);
    // Instead the accepted notice offers a manual Refresh, which re-reads the page.
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("GAP-CONTRACTS-DETAIL-06: clears the Pending pill when milestone status changes in props", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    const { rerender } = render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, mark complete" }));
    // Pill is visible while status is still "pending".
    await waitFor(() => expect(screen.getByLabelText("Status update pending")).toBeInTheDocument());
    // Simulate server catching up: status is now "completed".
    rerender(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "completed" }]}
      />,
    );
    // Completed milestone is filtered out of actionable list, so no pill.
    expect(screen.queryByLabelText("Status update pending")).not.toBeInTheDocument();
  });

});
