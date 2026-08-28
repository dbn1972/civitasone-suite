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
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0][0]).toContain("/milestones/m1/late");
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.notes).toBe("Vendor delayed material delivery by 2 weeks");
  });
});
