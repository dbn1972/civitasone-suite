import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown, source: string) => ({
    data: seed,
    provenance: source === "error" ? "cache" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { UsersTable } from "./UsersTable";

describe("UsersTable (InviteUserDialog) — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when inviting a user fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("identity-service: duplicate email constraint on tenant_users", { status: 409 }),
    );

    render(<UsersTable users={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Invite User" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Full name/i), { target: { value: "Asha Verma" } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/i), { target: { value: "asha@gov.in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/duplicate email constraint/i);
    expect(dialog.textContent).not.toMatch(/\b409\b/);
  });
});
