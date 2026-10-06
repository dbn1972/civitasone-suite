import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-TENANT-ADMIN-SESSIONS-DETAIL-01/-04: the page now fetches a real session
 * by id (identity-service GET /identity/sessions/:id) instead of rendering a
 * hard-coded "Rajesh Verma" constant for every id. These tests assert the real
 * data is shown, no fabricated name remains, MFA uses no emoji, and a 404
 * triggers notFound().
 */

const { notFound, getSessionById } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getSessionById: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => "admin-1",
}));

vi.mock("@/app/_data/loaders", () => ({
  getSessionById: (id: string) => getSessionById(id),
}));

import SessionDetailPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SessionDetailPage — real data (DETAIL-01/04)", () => {
  it("renders the fetched session's own user, not a hard-coded name", async () => {
    getSessionById.mockResolvedValue({
      source: "api",
      data: {
        id: "sess-real-1",
        userId: "u-9",
        userEmail: "asha@gov.in",
        userName: "Asha Rao",
        ipAddress: "10.0.2.45",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/121",
        mfaVerified: true,
        status: "active",
        lastActiveAt: "2026-09-01T09:05:00Z",
      },
    });

    const ui = await SessionDetailPage({ params: { id: "sess-real-1" } });
    render(ui);

    expect(screen.getByText("asha@gov.in")).toBeInTheDocument();
    expect(screen.queryByText(/Rajesh Verma/)).not.toBeInTheDocument();
    // MFA cell has no emoji.
    expect(document.body.textContent).not.toMatch(/✅|❌/);
    // IP is masked (host octets hidden).
    expect(document.body.textContent).toMatch(/10\.0\.•\.•/);
  });

  it("calls notFound() for a 404 session id (no fabricated data)", async () => {
    getSessionById.mockResolvedValue({ source: "error", status: 404, data: null });

    await expect(SessionDetailPage({ params: { id: "missing" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("hides the Revoke control on the admin's own session", async () => {
    getSessionById.mockResolvedValue({
      source: "api",
      data: {
        id: "sess-own",
        userId: "admin-1",
        userEmail: "admin@gov.in",
        userName: "The Admin",
        mfaVerified: true,
        status: "active",
        lastActiveAt: "2026-09-01T09:05:00Z",
      },
    });

    const ui = await SessionDetailPage({ params: { id: "sess-own" } });
    render(ui);

    expect(screen.queryByRole("button", { name: /Revoke Session/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your current session/i)).toBeInTheDocument();
  });
});
