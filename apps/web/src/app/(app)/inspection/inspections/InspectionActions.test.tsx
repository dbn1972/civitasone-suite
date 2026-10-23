import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// The reviewer hand-off dialog is translated client-side, so every render needs a provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/directory/searchUsers", () => ({
  searchDirectoryUsers: vi.fn(async () => [{ id: "99999999-2222-4333-8444-555555555555", label: "Rita Reviewer" }]),
  resolveDirectoryUsers: vi.fn(async () => []),
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
  it("disables the Start button until the 202 outcome is visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="aaaabbbb-2222-4333-8444-555555555555" status="scheduled" />);

    // Click and flush fetch/state updates.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });

    expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument();
    // Outcome not yet visible — button should be disabled (pending).
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  // GAP-INSPECTION-INSPECTIONS-02 + SF-15: after a 202 the row says "received" and
  // offers a manual Refresh (no timer-based refresh). While the outcome is
  // unknown the action stays disabled; after a Refresh that leaves the status
  // unchanged it is re-enabled with an honest "still being applied" hint.
  it("shows an accepted notice with a manual Refresh after a 202, and no timer refresh", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    const { rerender } = render(<InspectionRowAction id="aaaabbbb-2222-4333-8444-555555555555" status="scheduled" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });

    expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 5000)).toBe(false);
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/still being applied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();

    rerender(<InspectionRowAction id="aaaabbbb-2222-4333-8444-555555555555" status="in_progress" />);
    expect(screen.queryByText(/status will update shortly/i)).not.toBeInTheDocument();
  });

  it("Submit review POSTs { reviewerId } to /submit-review (never /transition) once a reviewer is chosen", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="completed" />);

    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: "Submit review" });
    expect(confirmBtn).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "Rita" } });
    fireEvent.mouseDown(await within(dialog).findByText("Rita Reviewer"));
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/status will update shortly/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0]![0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/submit-review");
    expect(fetchSpy.mock.calls[0]![0]).not.toContain("/transition");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({
      reviewerId: "99999999-2222-4333-8444-555555555555",
    });
  });
});
