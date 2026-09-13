import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RecoveryReferralCreateForm } from "./RecoveryReferralCreateForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Repeated default despite notices" } });
}

describe("RecoveryReferralCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a reason before opening the confirm dialog", () => {
    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
  });

  it("records a recovery referral on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ref-1", status: "accepted" }), { status: 202 }),
    );

    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));

    await waitFor(() => expect(screen.getByText("Refer this assessee for recovery?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Refer for recovery"));

    await waitFor(() => {
      expect(screen.getByText(/Recovery referral recorded/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<RecoveryReferralCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Refer for Recovery" }));

    await waitFor(() => expect(screen.getByText("Refer this assessee for recovery?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Refer for recovery"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });
});
