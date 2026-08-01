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

  it("PATCHes complete and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(
      <MilestoneActions
        contractId="cccccccc-dddd-4000-8000-0000000000cc"
        milestones={[{ id: "m1", title: "Earthwork", status: "pending" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0][0]).toContain("/milestones/m1/complete");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    expect(refreshMock).toHaveBeenCalled();
  });
});
