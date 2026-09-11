import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/lib/grants/application", async (orig) => {
  const actual = await orig<typeof import("@/lib/grants/application")>();
  return {
    ...actual,
    assignReviewer: vi.fn(),
    scoreApplication: vi.fn(),
    approveApplication: vi.fn(),
    rejectApplication: vi.fn(),
    withdrawApplication: vi.fn(),
  };
});

import { ApplicationActions } from "./ApplicationActions";
import * as api from "@/lib/grants/application";

const ALL_ACTIONS = ["assign-reviewer", "score", "approve", "reject", "withdraw"];

describe("ApplicationActions (COMP-012)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no actions are available for the current status", () => {
    const { container } = render(<ApplicationActions applicationId="app-1" actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("only renders buttons for actions allowed by the application's current status", () => {
    render(<ApplicationActions applicationId="app-1" actions={["score", "approve"]} />);
    expect(screen.getByRole("button", { name: "Submit Evaluation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Application" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign Reviewer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("assigns a reviewer via the real PATCH route and refreshes on success", async () => {
    vi.mocked(api.assignReviewer).mockResolvedValue(undefined);
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign Reviewer" }));
    fireEvent.change(screen.getByLabelText(/Reviewer reference/i), { target: { value: "rev-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(api.assignReviewer).toHaveBeenCalledWith("app-1", { reviewerRef: "rev-42" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("submits a score with reviewer + both numeric scores", async () => {
    vi.mocked(api.scoreApplication).mockResolvedValue(undefined);
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Evaluation" }));
    fireEvent.change(screen.getByLabelText(/Reviewer reference/i), { target: { value: "rev-1" } });
    fireEvent.change(screen.getByLabelText(/Technical score/i), { target: { value: "85" } });
    fireEvent.change(screen.getByLabelText(/Financial score/i), { target: { value: "72" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit evaluation" }));
    await waitFor(() =>
      expect(api.scoreApplication).toHaveBeenCalledWith("app-1", {
        reviewerRef: "rev-1",
        technicalScore: 85,
        financialScore: 72,
        recommendation: undefined,
      }),
    );
  });

  it("blocks a score submission with an out-of-range value instead of calling the API", async () => {
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Evaluation" }));
    fireEvent.change(screen.getByLabelText(/Reviewer reference/i), { target: { value: "rev-1" } });
    fireEvent.change(screen.getByLabelText(/Technical score/i), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText(/Financial score/i), { target: { value: "70" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit evaluation" }));
    });
    expect(await screen.findByText(/between 0 and 100/i)).toBeInTheDocument();
    expect(api.scoreApplication).not.toHaveBeenCalled();
  });

  it("approves with a rupee amount converted to minor units", async () => {
    vi.mocked(api.approveApplication).mockResolvedValue(undefined);
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve Application" }));
    fireEvent.change(screen.getByLabelText(/Sanctioned amount/i), { target: { value: "50000.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve application" }));
    await waitFor(() =>
      expect(api.approveApplication).toHaveBeenCalledWith("app-1", { amountApprovedMinor: 5000050 }),
    );
  });

  it("rejects with a reason of at least 10 characters", async () => {
    vi.mocked(api.rejectApplication).mockResolvedValue(undefined);
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "Missing supporting documents." } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(api.rejectApplication).toHaveBeenCalledWith("app-1", { reason: "Missing supporting documents." }),
    );
  });

  it("withdraws with a reason", async () => {
    vi.mocked(api.withdrawApplication).mockResolvedValue(undefined);
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: "No longer needed." } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Withdraw" }));
    await waitFor(() =>
      expect(api.withdrawApplication).toHaveBeenCalledWith("app-1", { reason: "No longer needed." }),
    );
  });

  it("surfaces an API error inline instead of silently failing", async () => {
    vi.mocked(api.approveApplication).mockRejectedValue(new Error("VALIDATION_FAILED: amountApprovedMinor must be positive"));
    render(<ApplicationActions applicationId="app-1" actions={ALL_ACTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve Application" }));
    fireEvent.change(screen.getByLabelText(/Sanctioned amount/i), { target: { value: "500" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve application" }));
    });
    expect(await screen.findByText(/VALIDATION_FAILED/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
