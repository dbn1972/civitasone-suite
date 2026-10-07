import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// Session identity is mocked per-test so we can exercise the maker-checker
// self-approval hide (GAP-PROCUREMENT-PLANNING-DETAIL-02).
const sessionMock = vi.fn();
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => sessionMock(),
}));

import { PlanLifecycleActions } from "./PlanLifecycleActions";
import { ToastProvider } from "@/app/_components/ds";

const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SUBMITTER = "6a6a6a6a-0000-4000-8000-000000000001";
const OTHER = "6a6a6a6a-0000-4000-8000-000000000002";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("PlanLifecycleActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
    // Default: a different officer is signed in (may approve).
    sessionMock.mockReturnValue({ loaded: true, userId: OTHER, roles: ["procurement_admin"] });
  });

  it("renders nothing for a terminal status (approved/rejected)", () => {
    const { container: approved } = renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="approved" />);
    expect(within(approved as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    const { container: rejected } = renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="rejected" />);
    expect(within(rejected as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows only Submit for a draft plan, and calls PATCH .../submit on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="draft" />);

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

  it("requires a reason to reject a pending plan", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="pending" submittedBy={SUBMITTER} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reject this plan?" });

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

  // GAP-PROCUREMENT-PLANNING-DETAIL-02: Approve must require a remark; the
  // confirm button stays disabled until one is entered, and the remark is
  // posted as `notes`.
  it("requires an approval remark and posts it as notes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="pending" submittedBy={SUBMITTER} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Approve this plan?" });

    const confirmBtn = within(dialog).getByRole("button", { name: "Approve" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Approval remarks (required)"), {
      target: { value: "Within sanctioned ceiling; approved." },
    });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/plans/${PLAN_ID}/approve`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ notes: "Within sanctioned ceiling; approved." }),
      }),
    );
  });

  // GAP-PROCUREMENT-PLANNING-DETAIL-02: the submitter of a plan must not be
  // offered Approve on their own plan (separation of duties).
  it("hides Approve from the submitter and explains why", () => {
    sessionMock.mockReturnValue({ loaded: true, userId: SUBMITTER, roles: ["procurement_admin"] });
    renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="pending" submittedBy={SUBMITTER} />);

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText(/must be approved by a different officer/i)).toBeInTheDocument();
    // Reject is still available (it is not a self-approval).
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("still offers Approve to a different officer", () => {
    sessionMock.mockReturnValue({ loaded: true, userId: OTHER, roles: ["procurement_admin"] });
    renderWithToast(<PlanLifecycleActions planId={PLAN_ID} status="pending" submittedBy={SUBMITTER} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
