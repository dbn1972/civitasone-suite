import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { ExperimentActions } from "./ExperimentActions";

describe("ExperimentActions (GAP-NOTIFICATIONS-EXPERIMENTS-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("offers 'Request winner approval' for a running experiment and posts to conclude", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ExperimentActions id="exp-1" status="running" />);

    fireEvent.click(screen.getByRole("button", { name: /request winner approval/i }));
    expect(await screen.findByText("Request winner approval?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^request approval$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/proxy/v1/notification/experiments/exp-1/conclude");
  });

  it("offers 'Approve winner' for a pending_approval experiment and posts to approve-winner", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ExperimentActions id="exp-2" status="pending_approval" />);

    fireEvent.click(screen.getByRole("button", { name: /^approve winner$/i }));
    expect(await screen.findByText("Approve and promote the winner?")).toBeInTheDocument();
    const approveButtons = screen.getAllByRole("button", { name: /approve winner/i });
    fireEvent.click(approveButtons[approveButtons.length - 1]!);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/proxy/v1/notification/experiments/exp-2/approve-winner");
  });

  it("renders nothing actionable for a concluded experiment", () => {
    render(<ExperimentActions id="exp-3" status="concluded" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a clerk-safe error when the approve call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 403 }));
    render(<ExperimentActions id="exp-4" status="pending_approval" />);
    fireEvent.click(screen.getByRole("button", { name: /^approve winner$/i }));
    const confirmBtns = await screen.findAllByRole("button", { name: /approve winner/i });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    await waitFor(() => expect(screen.queryByText("Approve and promote the winner?")).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/^boom$/)).not.toBeInTheDocument();
  });
});
