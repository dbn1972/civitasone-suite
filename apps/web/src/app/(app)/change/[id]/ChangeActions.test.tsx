import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ChangeActions } from "./ChangeActions";

const ID = "11111111-2222-4333-8444-555555555555";

describe("ChangeActions (GAP-CHANGE-DETAIL-01 / -02 / -04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("DETAIL-01: Approve opens a confirm dialog; Cancel fires no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ChangeActions id={ID} status="submitted" hasRollbackPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Approve (CAB)" }));
    await screen.findByText("Approve this change?");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText("Approve this change?")).not.toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DETAIL-02: Approve sends the typed rationale as `note`, never 'Approved via console'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    render(<ChangeActions id={ID} status="submitted" hasRollbackPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Approve (CAB)" }));
    await screen.findByText("Approve this change?");
    fireEvent.change(screen.getByLabelText(/Approval rationale/i), { target: { value: "CAB reviewed, approved." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain(`/api/proxy/v1/admin/change/requests/${ID}/approve`);
    const body = JSON.parse((call[1] as RequestInit).body as string) as { note?: string };
    expect(body.note).toBe("CAB reviewed, approved.");
    expect(body.note).not.toBe("Approved via console");
  });

  it("DETAIL-02: Reject cannot be confirmed with a blank reason, enables once 10+ chars typed", async () => {
    render(<ChangeActions id={ID} status="submitted" hasRollbackPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText("Reject this change?");
    // Two "Reject" buttons exist while open (trigger + dialog confirm); the
    // dialog confirm is the last one in the DOM.
    const dialogConfirm = screen.getAllByRole("button", { name: "Reject" }).at(-1)!;
    expect(dialogConfirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Rejection reason/i), { target: { value: "Insufficient test evidence." } });
    expect(screen.getAllByRole("button", { name: "Reject" }).at(-1)!).not.toBeDisabled();
  });

  it("DETAIL-04: Schedule is disabled for an empty/invalid window and shows an error when end<=start", () => {
    render(<ChangeActions id={ID} status="approved" hasRollbackPlan />);
    const schedule = screen.getByRole("button", { name: "Schedule release" });
    expect(schedule).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Window start"), { target: { value: "2026-09-14T22:00" } });
    fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "2026-09-14T20:00" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/end must be after its start/i);
    expect(screen.getByRole("button", { name: "Schedule release" })).toBeDisabled();
  });

  it("DETAIL-04: a valid 22:00->02:00 next-day window enables Schedule", () => {
    render(<ChangeActions id={ID} status="approved" hasRollbackPlan />);
    fireEvent.change(screen.getByLabelText("Window start"), { target: { value: "2026-09-14T22:00" } });
    fireEvent.change(screen.getByLabelText("Window end"), { target: { value: "2026-09-15T02:00" } });
    expect(screen.getByRole("button", { name: "Schedule release" })).not.toBeDisabled();
  });
});
