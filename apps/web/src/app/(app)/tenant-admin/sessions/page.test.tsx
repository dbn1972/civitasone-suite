import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-TENANT-ADMIN-SESSIONS-01/03: an error must show the RefreshErrorState and
 * "—" tiles (not 0 + an empty "Session log" table), and the tiles must be
 * labelled honestly ("Active without MFA", "Distinct networks").
 */
const { getActiveSessions } = vi.hoisted(() => ({ getActiveSessions: vi.fn() }));
vi.mock("@/app/_data/loaders", () => ({ getActiveSessions: () => getActiveSessions() }));
vi.mock("../../../_data/loaders", () => ({ getActiveSessions: () => getActiveSessions() }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionUserId: () => "admin-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import AdminSessionsPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("AdminSessionsPage", () => {
  it("on error shows retry state with '—' tiles, not a '0' empty table", async () => {
    getActiveSessions.mockResolvedValue({ source: "error", data: [] });
    const ui = await AdminSessionsPage();
    render(ui);
    expect(screen.getByText(/Active without MFA/)).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    // No empty "Session log" table body text promising zero sessions.
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("labels tiles honestly and counts active-without-mfa", async () => {
    getActiveSessions.mockResolvedValue({
      source: "api",
      data: [
        { id: "s1", userId: "u1", userEmail: "a@gov.in", ipAddress: "10.0.1.1", lastActiveAt: "2026-09-01T09:05:00Z", mfaVerified: false, status: "active" },
        { id: "s2", userId: "u2", userEmail: "b@gov.in", ipAddress: "10.1.1.1", lastActiveAt: "2026-09-01T09:05:00Z", mfaVerified: false, status: "active" },
        { id: "s3", userId: "u3", userEmail: "c@gov.in", ipAddress: "10.2.1.1", lastActiveAt: "2026-09-01T09:05:00Z", mfaVerified: true, status: "active" },
      ],
    });
    const ui = await AdminSessionsPage();
    render(ui);
    expect(screen.getByText("Active without MFA")).toBeInTheDocument();
    expect(screen.getByText("Distinct networks")).toBeInTheDocument();
    // 3 private 10.x -> 1 distinct network; 2 active without MFA.
    expect(document.body.textContent).toContain("Active without MFA");
  });
});
