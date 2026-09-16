import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { UserSecurityActions } from "./UserSecurityActions";

describe("UserSecurityActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when the reset-password request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("identity-service: user not found in realm", { status: 404 }),
    );

    render(<UserSecurityActions userId="u-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/user not found in realm/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b404\b/);
  });
});
