import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { InspectionRowAction } from "./InspectionActions";

describe("InspectionRowAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs transition and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="scheduled" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/transition");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({
      targetState: "in_progress",
      remarks: "Started from inspection hub",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("Finalize requires a real confirm step and sends no Content-Type header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="under_review" />);
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Finalize inspection" }));
    await waitFor(() => expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument());

    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/finalize");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
  });

  it("shows a clerk-safe message when transition fails, never the raw response text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid transition", { status: 422 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="scheduled" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument()
    );
    expect(screen.queryByText(/invalid transition/i)).not.toBeInTheDocument();
  });

  it("Complete requires typed remarks and sends them as body.remarks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="in_progress" />);

    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");

    const confirmBtn = within(dialog).getByRole("button", { name: "Complete" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Fire exits clear; extinguishers serviced." },
    });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/transition");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({
      targetState: "completed",
      remarks: "Fire exits clear; extinguishers serviced.",
    });
  });

  // GAP-INSPECTION-INSPECTIONS-02: after a 202, the Start button is disabled
  // while the follow-up poll is in flight to prevent duplicate commands.
  it("disables the Start button while the follow-up poll is pending", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="aaaabbbb-2222-4333-8444-555555555555" status="scheduled" />);

    // Click and flush fetch/state updates without advancing the fake 5s timer.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });

    expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument();
    // 5s timer has not fired yet — button should be disabled (pending).
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    vi.useRealTimers();
  });

  // GAP-INSPECTION-INSPECTIONS-02: if status is still the same after the
  // follow-up refresh, the component should show a "still processing" warning.
  it("shows a stale warning when status is unchanged 5s after a 202", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="aaaabbbb-2222-4333-8444-555555555555" status="scheduled" />);

    // Click and flush fetch/state updates without advancing the fake timer.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });

    expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument();

    // Advance past the 5-second follow-up timer; act() flushes the React state
    // updates that the timer callback (setPollDue) triggers.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // router.refresh() was called again; status prop still "scheduled" -> stale warning.
    expect(screen.getByRole("status")).toHaveTextContent(/unchanged.*may still be processing/i);

    vi.useRealTimers();
  });
});
