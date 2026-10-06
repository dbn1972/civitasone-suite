import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getTenantAdminDashboardMock = vi.fn();
vi.mock("../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../_data/loaders")>("../../_data/loaders");
  return { ...actual, getTenantAdminDashboard: (...a: unknown[]) => getTenantAdminDashboardMock(...a) };
});
const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import TenantAdminPage from "./page";

const DASH = { kpis: [], health: { status: "ok", services: [] }, readiness: null, modules: [] };

describe("TenantAdminPage — GAP-TENANT-ADMIN-PLATFORM-CONFIG-04 tile gating", () => {
  beforeEach(() => {
    getTenantAdminDashboardMock.mockReset();
    getTenantAdminDashboardMock.mockResolvedValue({ data: DASH, source: "api" });
  });

  it("hides the Platform Config tile from a tenant_admin", async () => {
    rolesMock.mockReturnValue(["tenant_admin"]);
    render(await TenantAdminPage({}));
    expect(screen.queryByText("Platform Config")).toBeNull();
  });

  it("shows the Platform Config tile to a platform_admin", async () => {
    rolesMock.mockReturnValue(["platform_admin"]);
    render(await TenantAdminPage({}));
    expect(screen.getByText("Platform Config")).toBeInTheDocument();
  });
});
