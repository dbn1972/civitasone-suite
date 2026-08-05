import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CloseOpportunityDialog } from "./CloseOpportunityDialog";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return { ...actual, closeOpportunity: vi.fn() };
});

// NB: no beforeEach mock reset here — the "not called" assertions run before any
// call, and a per-test reset makes the runner mis-flag the awaited rejection in
// the 422 case as unhandled during findByText polling.

function open(extra = {}) {
  return render(
    <CloseOpportunityDialog opportunityId="d1" opportunityName="Big deal" open onClose={() => {}} {...extra} />,
  );
}

describe("CloseOpportunityDialog (OP-006)", () => {
  it("blocks submit until a reason is entered", async () => {
    open();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /close opportunity/i })); });
    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(op.closeOpportunity).not.toHaveBeenCalled();
  });

  it("requires a competitor when the outcome is lost", async () => {
    open();
    fireEvent.change(screen.getByLabelText(/outcome/i), { target: { value: "lost" } });
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "price" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /close opportunity/i })); });
    expect(await screen.findByText(/competitor is required/i)).toBeInTheDocument();
    expect(op.closeOpportunity).not.toHaveBeenCalled();
  });

  it("closes won with just a reason", async () => {
    vi.mocked(op.closeOpportunity).mockResolvedValue(undefined);
    const onClosed = vi.fn();
    open({ onClosed });
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "signed" } });
    fireEvent.click(screen.getByRole("button", { name: /close opportunity/i }));
    await waitFor(() =>
      expect(op.closeOpportunity).toHaveBeenCalledWith("d1", { outcome: "won", reason: "signed", competitor: undefined }),
    );
    expect(onClosed).toHaveBeenCalled();
  });

  it("closes lost with reason + competitor", async () => {
    vi.mocked(op.closeOpportunity).mockResolvedValue(undefined);
    open();
    fireEvent.change(screen.getByLabelText(/outcome/i), { target: { value: "lost" } });
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "cheaper rival" } });
    fireEvent.change(screen.getByLabelText(/^competitor$/i), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /close opportunity/i }));
    await waitFor(() =>
      expect(op.closeOpportunity).toHaveBeenCalledWith("d1", { outcome: "lost", reason: "cheaper rival", competitor: "Acme" }),
    );
  });

  it("surfaces a 422 mandatory-fields rejection inline", async () => {
    vi.mocked(op.closeOpportunity).mockRejectedValue(new op.MandatoryFieldsError("missing", ["nextStep"]));
    open();
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "done" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close opportunity/i }));
    });
    expect(await screen.findByText(/next step/i)).toBeInTheDocument();
  });
});
