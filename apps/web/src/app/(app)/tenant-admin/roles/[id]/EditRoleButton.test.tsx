import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditRoleButton } from "./EditRoleButton";

describe("EditRoleButton — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when saving the role fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("constraint violation on roles.name", { status: 500 }),
    );

    render(<EditRoleButton roleId="r-1" name="Finance Reviewer" description="Can review vouchers" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit role" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/constraint violation/i);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
