import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAdminRolesListMock = vi.fn();
const getOrgHierarchyLevelsMock = vi.fn();
const getTenantAuditLogMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getAdminRolesList: () => getAdminRolesListMock(),
  getOrgHierarchyLevels: () => getOrgHierarchyLevelsMock(),
  getTenantAuditLog: () => getTenantAuditLogMock(),
}));

const getSessionRolesMock = vi.fn<() => string[]>(() => ["platform_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
  requireAnyRole: (allowed: string[]) => { if (!getSessionRolesMock().some((r) => allowed.includes(r))) throw new Error("REDIRECT"); },
  PLATFORM_ADMIN_ROLES: ["platform_admin", "super_admin", "tenant_admin"],
}));

import PlatformAdminPage from "./page";

describe("PlatformAdminPage (GAP-PLATFORM-ADMIN-HOME-02/03)", () => {
  beforeEach(() => {
    getAdminRolesListMock.mockReset();
    getOrgHierarchyLevelsMock.mockReset();
    getTenantAuditLogMock.mockReset();
    getSessionRolesMock.mockReset().mockReturnValue(["platform_admin"]);
  });

  // GAP-PLATFORM-ADMIN-HOME-02: the roles tile reflects the loader count, not
  // a hardcoded 9.
  it("drives the Platform Roles tile from the loader (3 roles -> shows 3)", async () => {
    getAdminRolesListMock.mockResolvedValue({ data: [{}, {}, {}], source: "api" });
    getOrgHierarchyLevelsMock.mockResolvedValue({ data: [{}, {}], source: "api" });
    getTenantAuditLogMock.mockResolvedValue({ data: [], source: "api" });

    render((await PlatformAdminPage()) as React.ReactElement);
    const rolesTile = screen.getByText("Platform Roles").closest("*")?.parentElement;
    expect(rolesTile?.textContent).toContain("3");
    // No hardcoded 9 "Platform Roles".
    expect(rolesTile?.textContent).not.toContain("9");
  });

  // GAP-PLATFORM-ADMIN-HOME-02: a source in error renders "—", not a fabricated figure.
  it("renders '—' for the roles tile when the loader errors", async () => {
    getAdminRolesListMock.mockResolvedValue({ data: [], source: "error" });
    getOrgHierarchyLevelsMock.mockResolvedValue({ data: [], source: "error" });
    getTenantAuditLogMock.mockResolvedValue({ data: [], source: "error" });

    render((await PlatformAdminPage()) as React.ReactElement);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // "Live" literal is gone.
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  // GAP-PLATFORM-ADMIN-HOME-03: the nav link's accessible name must not
  // include the emoji glyph.
  it("gives each nav link an accessible name without the emoji", async () => {
    getAdminRolesListMock.mockResolvedValue({ data: [], source: "api" });
    getOrgHierarchyLevelsMock.mockResolvedValue({ data: [], source: "api" });
    getTenantAuditLogMock.mockResolvedValue({ data: [], source: "api" });

    render((await PlatformAdminPage()) as React.ReactElement);
    const link = screen.getByRole("link", { name: /System Settings/ });
    // The emoji is aria-hidden, so it is not part of the computed accessible name.
    expect(link).toHaveAccessibleName(expect.not.stringContaining("⚙️"));
    expect(link).toHaveAccessibleName(expect.stringContaining("System Settings"));
  });

  // Review round 1: layouts do not re-render on soft navigation, so the page re-checks the role.
  it("redirects an audit reviewer away from the platform-admin home (they may only open the audit log)", async () => {
    getSessionRolesMock.mockReturnValue(["auditor"]);
    await expect(PlatformAdminPage()).rejects.toThrow("REDIRECT");
  });
});
