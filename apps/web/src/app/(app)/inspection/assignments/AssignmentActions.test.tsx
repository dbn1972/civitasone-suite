import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AssignmentActions } from "./AssignmentActions";

describe("AssignmentActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs create assignment and expects 202 Accepted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<AssignmentActions />);
    const inputs = screen.getAllByPlaceholderText("UUID");
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    for (const inp of inputs.slice(0, 4)) {
      fireEvent.change(inp, { target: { value: "11111111-2222-4333-8444-555555555555" } });
    }
    fireEvent.click(screen.getByRole("button", { name: /create|assign|submit/i }));
    await waitFor(() => expect(screen.getByText(/accepted \(queued\)/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/assignments");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces error text when create fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("validation failed", { status: 400 }),
    );
    render(<AssignmentActions />);
    fireEvent.click(screen.getByRole("button", { name: /create|assign|submit/i }));
    await waitFor(() => expect(screen.getByText(/validation failed|failed/i)).toBeInTheDocument());
  });
});
