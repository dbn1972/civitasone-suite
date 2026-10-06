import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SessionRevokeCell } from "./SessionRevokeCell";

describe("SessionRevokeCell — GAP-TENANT-ADMIN-USERS-DETAIL-02", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not DELETE until a reason is confirmed; sends the reason in the body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<SessionRevokeCell sessionId="s-1" active />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke this session" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "stolen laptop" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke session" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/identity/sessions/s-1");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ reason: "stolen laptop" });
  });

  it("shows a clerk-safe message, never the raw server body, on a 500 with an HTML body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>redis session store unreachable</html>", { status: 500 }),
    );

    render(<SessionRevokeCell sessionId="s-1" active />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke this session" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "some reason" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke session" }));

    await waitFor(() => expect(dialog.textContent).not.toMatch(/redis session store/i));
    expect(dialog.textContent).not.toMatch(/<html>/);
  });

  it("renders a disabled control for a non-active session", () => {
    render(<SessionRevokeCell sessionId="s-2" active={false} />);
    expect(screen.getByText("Revoke")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Revoke this session" })).not.toBeInTheDocument();
  });
});
