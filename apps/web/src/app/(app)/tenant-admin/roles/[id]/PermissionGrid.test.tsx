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

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/malformed effect/i);
    expect(dialog.textContent).not.toMatch(/\b400\b/);
    // The resource:action context prefix is preserved.
    expect(dialog.textContent).toMatch(/finance:read/i);
  });
});
