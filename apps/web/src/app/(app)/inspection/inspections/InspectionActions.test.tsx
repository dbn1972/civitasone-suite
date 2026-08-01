import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { InspectionRowAction } from "./InspectionActions";

describe("InspectionRowAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs transition and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<InspectionRowAction id="11111111-2222-4333-8444-555555555555" status="scheduled" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(fetchSpy.mock.calls[0][0]).toContain("/inspections/11111111-2222-4333-8444-555555555555/transition");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toEqual({
      targetState: "in_progress",
      remarks: "Started from inspection hub",
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
