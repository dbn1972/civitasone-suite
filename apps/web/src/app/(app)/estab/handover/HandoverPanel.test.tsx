import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { HandoverPanel } from "./HandoverPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const urlOf = (args: unknown[]): string => (typeof args[0] === "string" ? args[0] : "");

const OPS = [
  { id: "op-1", employeeId: "00000000-0000-0000-0000-000000000001", division: "Admin", deskRole: "section_officer", active: true },
  { id: "op-2", employeeId: "00000000-0000-0000-0000-000000000002", division: "Estab", deskRole: "under_secretary", active: true },
];

describe("HandoverPanel — charge handover safety & truthful states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT reassign charge on a bare click — it opens a ConfirmDialog, and only POSTs after confirming (L4)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: OPS })) // operators
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // handovers history
      .mockResolvedValueOnce(jsonResponse({})) // POST /handovers (only after confirm)
      .mockResolvedValue(jsonResponse({ data: [] })); // any later reload (post-success setTimeout)

    const { container } = render(<HandoverPanel />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: OPS[0].employeeId } }); // from
    fireEvent.change(selects[1], { target: { value: OPS[1].employeeId } }); // to

    fireEvent.click(screen.getByRole("button", { name: "Hand over charge" }));

    // The bulk reassignment must NOT fire on the click.
    expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/handovers") && c[1] && (c[1] as RequestInit).method === "POST")).toBe(false);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Hand over charge");
    expect(confirmBtn).toBeTruthy();

    fireEvent.click(confirmBtn!);
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some((c) => urlOf(c).includes("/handovers") && (c[1] as RequestInit | undefined)?.method === "POST"),
      ).toBe(true),
    );
  });

  it("shows a real error state (not 'No handovers recorded') when the history load fails (L3)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: OPS })) // operators OK
      .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500)); // handovers 500

    render(<HandoverPanel />);

    // A failed load must surface an assertive error with a retry — never the empty state.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No handovers recorded.")).toBeNull();
  });
});
