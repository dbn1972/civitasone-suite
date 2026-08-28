import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DealDetailActions } from "./DealDetailActions";

const DEAL_ID = "45a216ec-a498-42b8-aabd-ac1bd4b5b1c5";

describe("DealDetailActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // Regression test for two CRITICAL/HIGH bugs found together:
  // 1) markStage() PATCHed .../stage without the `version` the backend
  //    requires (updateDealStageBody.version, z.number().int().min(1)) —
  //    every Mark Won/Lost 400'd.
  // 2) The mandatory "reason" ConfirmDialog captures was never even threaded
  //    into onConfirm (`onConfirm={() => markStage("Won")}` dropped it), and
  //    even if it had been, PATCH .../stage has no `reason` field in its
  //    schema at all — a citizen-facing "recorded in the audit trail" claim
  //    that could never be true either way.
  // Fix: close via the dedicated POST .../close endpoint (outcome + reason),
  // the same one CloseOpportunityDialog.tsx already uses for Opportunities.
  it("marks a deal won via the dedicated close endpoint, sending the typed reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: DEAL_ID } }), { status: 200 }),
    );

    render(<DealDetailActions dealId={DEAL_ID} dealName="Municipal Waste Contract" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Won" }));
    await waitFor(() => expect(screen.getByText(/Mark .Municipal Waste Contract. as won\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / closing note"), { target: { value: "Signed PO received" } });
    // confirmLabel matches the trigger label ("Mark Won"), so once the dialog
    // is open there are two buttons with that name — the second is the
    // dialog's own confirm button.
    fireEvent.click(screen.getAllByRole("button", { name: "Mark Won" })[1]!);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/deals/${DEAL_ID}/close`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      outcome: "won",
      reason: "Signed PO received",
    });
  });

  it("marks a deal lost (danger action) via the dedicated close endpoint, sending the typed reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: DEAL_ID } }), { status: 200 }),
    );

    render(<DealDetailActions dealId={DEAL_ID} dealName="Municipal Waste Contract" status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Lost" }));
    await waitFor(() => expect(screen.getByText(/Mark .Municipal Waste Contract. as lost\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for loss"), { target: { value: "Lost to a lower bidder" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Mark Lost" })[1]!);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/deals/${DEAL_ID}/close`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      outcome: "lost",
      reason: "Lost to a lower bidder",
    });
  });

  it("disables both close actions once the deal is already closed", () => {
    render(<DealDetailActions dealId={DEAL_ID} dealName="Municipal Waste Contract" status="won" />);
    expect(screen.getByRole("button", { name: "Mark Won" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark Lost" })).toBeDisabled();
  });
});
