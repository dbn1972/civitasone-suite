import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getTenantAuditLogMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getTenantAuditLog: () => getTenantAuditLogMock(),
}));

const getSessionRolesMock = vi.fn<() => string[]>(() => ["platform_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import PlatformAuditLogPage from "./page";

describe("PlatformAuditLogPage (GAP-PLATFORM-ADMIN-AUDIT-LOG-01/03)", () => {
  beforeEach(() => {
    getTenantAuditLogMock.mockReset();
    getSessionRolesMock.mockReset().mockReturnValue(["platform_admin"]);
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-01: a failed load must NOT read as an empty
  // audit trail (0 stats + "No events match"); it must surface a retry state.
  it("renders a retry state on a load error, not zeroed stats and an empty table", async () => {
    getTenantAuditLogMock.mockResolvedValue({ data: [], source: "error" });
    render((await PlatformAuditLogPage()) as React.ReactElement);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No events match the current filters.")).not.toBeInTheDocument();
    // The stat tiles (which would show "0") must not render on the error branch.
    expect(screen.queryByText("Events (today)")).not.toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-AUDIT-LOG-03: "Events (today)" is counted on the IST
  // calendar day. An event at 2026-09-28T23:00:00Z is 2026-09-29 04:30 IST.
  it("counts events by their IST calendar day for the 'today' tile", async () => {
    // Freeze "now" to 2026-09-29T01:00:00Z (06:30 IST on 2026-09-29).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T01:00:00.000Z"));
    try {
      getTenantAuditLogMock.mockResolvedValue({
        data: [
          { id: "a", timestamp: "2026-09-28T23:00:00.000Z", actor: "x", action: "role.update", outcome: "success" },
          { id: "b", timestamp: "2026-09-27T10:00:00.000Z", actor: "y", action: "role.update", outcome: "success" },
        ],
        source: "api",
      });
      render((await PlatformAuditLogPage()) as React.ReactElement);
      // Both the "today" tile label and value "1" render (event a is IST 2026-09-29).
      expect(screen.getByText("Events (today)")).toBeInTheDocument();
      // Find the StatCard value 1 near the tile. The tile value is rendered as text "1".
      const tile = screen.getByText("Events (today)").closest("*")?.parentElement;
      expect(tile?.textContent).toContain("1");
    } finally {
      vi.useRealTimers();
    }
  });
});
