import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { RemoveMemberButton } from "./RemoveMemberButton";

/**
 * GAP2-PROJECTS-MEMBERS-06: the members table was add-only; a role-gated Remove
 * control now backs DELETE /v1/projects/:id/members/:memberId. These fail on
 * the old tree (no RemoveMemberButton existed).
 */
describe("RemoveMemberButton (GAP2-PROJECTS-MEMBERS-06)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("confirms, then DELETEs the member via the proxy and refreshes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "m1", status: "accepted" }), { status: 202 }));

    render(<RemoveMemberButton projectId="p1" memberId="m1" memberLabel="Asha Rao" />);

    // Trigger opens the confirm dialog; nothing is sent yet.
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(fetchSpy).not.toHaveBeenCalled();

    // Confirm — the dialog's confirm button is also named "Remove".
    const confirmBtn = screen.getAllByRole("button", { name: /remove/i }).pop()!;
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/proxy/v1/projects/p1/members/m1")).toBe(true),
    );
    const call = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/proxy/v1/projects/p1/members/m1")!;
    expect((call[1] as RequestInit).method).toBe("DELETE");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces an error and does not refresh when the server rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "FORBIDDEN", message: "nope" }), { status: 403 }),
    );
    render(<RemoveMemberButton projectId="p1" memberId="m1" memberLabel="Asha Rao" />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /remove/i }).pop()!;
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(refreshMock).not.toHaveBeenCalled());
  });
});
