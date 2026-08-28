import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PlanLifecycleActions } from "./PlanLifecycleActions";

const PLAN_ID = "22222222-2222-2222-2222-222222222222";

describe("PlanLifecycleActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // Regression test: before this component existed, a draft/pending Annual
  // Procurement Plan had no submit/approve/reject UI anywhere in the app —
  // see planning/[id]/page.tsx and _data/loaders.ts.
  it("renders nothing for a terminal status (approved/rejected)", () => {
    const { container: approved } = render(<PlanLifecycleActions planId={PLAN_ID} status="approved" />);
    expect(approved).toBeEmptyDOMElement();
    const { container: rejected } = render(<PlanLifecycleActions planId={PLAN_ID} status="rejected" />);
    expect(rejected).toBeEmptyDOMElement();
  });

  it("shows only Submit for a draft plan, and calls PATCH .../submit on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<PlanLifecycleActions planId={PLAN_ID} status="draft" />);

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Submit this plan for approval?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/plans/${PLAN_ID}/submit`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows Approve and Reject for a pending plan, and requires a reason to reject", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<PlanLifecycleActions planId={PLAN_ID} status="pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reject this plan?" });

    // Backend requires a non-empty reason (rejectPlanBody) — the confirm
    // button must stay disabled until one is entered.
    const confirmBtn = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Reason for rejection (required)"), {
      target: { value: "Budget line missing sanction reference" },
    });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/plans/${PLAN_ID}/reject`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ reason: "Budget line missing sanction reference" }),
      }),
    );
  });

  it("approves a pending plan via PATCH .../approve", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<PlanLifecycleActions planId={PLAN_ID} status="pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Approve this plan?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/plans/${PLAN_ID}/approve`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
