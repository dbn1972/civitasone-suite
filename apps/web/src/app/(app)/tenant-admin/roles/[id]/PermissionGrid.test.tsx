import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PermissionGrid } from "./PermissionGrid";

describe("PermissionGrid — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message (prefixed with the resource:action), never the raw response body, when saving fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("policy-service rejected: malformed effect", { status: 400 }),
    );

    render(<PermissionGrid roleId="r-1" permissions={[]} editable />);
    fireEvent.click(screen.getByRole("button", { name: /finance read: inherit/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save 1 change/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for change/i), { target: { value: "grant read access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/Some details weren't accepted\. Check what you entered and try again\./));
    expect(dialog.textContent).not.toMatch(/malformed effect/i);
    expect(dialog.textContent).not.toMatch(/\b400\b/);
    // The resource:action context prefix is preserved.
    expect(dialog.textContent).toMatch(/finance:read/i);
  });
});

describe("PermissionGrid — GAP-TENANT-ADMIN-ROLES-DETAIL-01/-02/-04", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a saved cell toggles Allow⇄Deny only — never resets to Inherit (-01)", () => {
    render(<PermissionGrid roleId="r-1" permissions={[{ module: "finance", action: "read", allowed: true }]} editable />);
    const cell = screen.getByRole("button", { name: /finance read: allow/i });
    fireEvent.click(cell); // allow -> deny
    expect(screen.getByRole("button", { name: /finance read: deny/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /finance read: deny/i })); // deny -> allow (NOT inherit)
    expect(screen.getByRole("button", { name: /finance read: allow/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finance read: inherit/i })).toBeNull();
  });

  it("sends the audit reason in the request BODY, not as x-correlation-id (-04)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<PermissionGrid roleId="r-1" permissions={[]} editable />);
    fireEvent.click(screen.getByRole("button", { name: /finance read: inherit/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save 1 change/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for change/i), { target: { value: "grant read access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-correlation-id"]).toBeUndefined();
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ resource: "finance", action: "read", reason: "grant read access" });
  });

  it("on a mid-way failure reports N of M saved and drops the succeeded cells (-02)", async () => {
    // 2 changes: first POST ok, second fails.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    render(<PermissionGrid roleId="r-1" permissions={[]} editable />);
    fireEvent.click(screen.getByRole("button", { name: /finance read: inherit/i }));
    fireEvent.click(screen.getByRole("button", { name: /finance create: inherit/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save 2 changes/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for change/i), { target: { value: "grant access" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(dialog.textContent).toMatch(/1 of 2 changes saved; 1 failed/i));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
