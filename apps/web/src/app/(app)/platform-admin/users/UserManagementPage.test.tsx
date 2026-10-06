import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown) => ({ data: seed }),
}));

import { UserManagementPage } from "./UserManagementPage";

const USERS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Asha Rao",
    email: "asha@example.gov.in",
    roles: ["tenant_admin"],
    status: "active",
    mfaEnabled: true,
    lastLoginAt: null,
  },
];

function mockFetch(status: number, body: unknown = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return this;
    },
  }) as unknown as typeof fetch;
}

/** USERS-03: suspend now requires a reason before Confirm enables. */
function typeSuspendReason(text = "Policy violation under review") {
  fireEvent.change(screen.getByLabelText("Reason for suspension"), { target: { value: text } });
}

describe("UserManagementPage (COMP-012 + USERS-02/03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMock.mockReset();
  });

  it("suspend calls the real identity-service route (PATCH .../status) with a reason", async () => {
    mockFetch(202);
    render(<UserManagementPage users={USERS} currentUserId="someone-else" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    typeSuspendReason();
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/proxy/v1/admin/users/${USERS[0].id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "suspended", reason: "Policy violation under review" }),
        }),
      ),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a failed suspend instead of silently succeeding", async () => {
    mockFetch(404, { code: "NOT_FOUND", message: "route not found" });
    render(<UserManagementPage users={USERS} currentUserId="someone-else" />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    typeSuspendReason();
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    expect(await screen.findByText(/could not suspend user/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("'Reset password' is a real action (not a dead link) that POSTs the reset-password route", async () => {
    mockFetch(202);
    render(<UserManagementPage users={USERS} />);
    const resetButton = screen.getByRole("button", { name: "Reset password" });
    expect(resetButton.tagName).toBe("BUTTON");
    fireEvent.click(resetButton);
    // Dialog open -> row button + confirm button both read "Reset password"; the confirm is the last.
    fireEvent.click(screen.getAllByRole("button", { name: "Reset password" }).slice(-1)[0]);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/proxy/v1/admin/users/${USERS[0].id}/reset-password`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("surfaces a failed password reset instead of silently succeeding", async () => {
    mockFetch(500, { code: "INTERNAL", message: "boom" });
    render(<UserManagementPage users={USERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Reset password" }).slice(-1)[0]);
    expect(await screen.findByText(/could not start a password reset/i)).toBeInTheDocument();
  });
});
