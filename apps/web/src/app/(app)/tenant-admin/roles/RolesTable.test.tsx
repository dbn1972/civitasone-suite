import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RolesTable } from "./RolesTable";

describe("RolesTable (NewRoleDialog) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when creating a role fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("role name already exists in this tenant", { status: 409 }),
    );

    render(<RolesTable roles={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New Role" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Role name/i), { target: { value: "Finance Reviewer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/already exists/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});
