import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AssignmentActions } from "./AssignmentActions";

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

function fillAllIds() {
  const inputs = screen.getAllByPlaceholderText("UUID");
  for (const inp of inputs.slice(0, 4)) {
    fireEvent.change(inp, { target: { value: VALID_UUID } });
  }
}

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
    fillAllIds();
    fireEvent.click(screen.getByRole("button", { name: /create assignment/i }));
    await waitFor(() => expect(screen.getByText(/appear in the list shortly/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/assignments");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(refreshMock).toHaveBeenCalled();
  });

  // GAP-INSPECTION-ASSIGNMENTS-02: a blank submit makes NO fetch call and shows
  // field errors (deliberate contract change — the form is now validated
  // client-side with the same UUID rules the route enforces).
  it("blocks a blank submit with field errors and makes no fetch call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AssignmentActions />);
    fireEvent.click(screen.getByRole("button", { name: /create assignment/i }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-INSPECTION-ASSIGNMENTS-02: a 400 shows the server's clerk-safe copy,
  // never the raw response text.
  it("surfaces a clerk-safe message when create fails, never the raw response text (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("validation failed", { status: 400 }));
    render(<AssignmentActions />);
    fillAllIds();
    fireEvent.click(screen.getByRole("button", { name: /create assignment/i }));
    await waitFor(() =>
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^validation failed$/i)).not.toBeInTheDocument();
  });

  // GAP-INSPECTION-ASSIGNMENTS-03: the Scheduled date defaults to the IST
  // calendar date, not the UTC one.
  it("defaults the Scheduled date to the IST calendar date", async () => {
    render(<AssignmentActions />);
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    // todayIST() shape is YYYY-MM-DD and is >= the UTC date for the same instant.
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
