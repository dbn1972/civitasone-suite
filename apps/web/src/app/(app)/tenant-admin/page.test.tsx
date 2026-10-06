import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getTenantAdminDashboardMock = vi.fn();
vi.mock("../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../_data/loaders")>("../../_data/loaders");
  return { ...actual, getTenantAdminDashboard: (...args: unknown[]) => getTenantAdminDashboardMock(...args) };
});
let mockRoles: string[] = ["platform_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import TenantAdminPage from "./page";

// getTenantAdminDashboard is itself a composite loader (users + modules +
// health + readiness) that already combines its 4 sub-fetches into one
// top-level `source: "error" | "api"` -- see loaders.ts. Mocking it
// directly (rather than re-deriving all 4 underlying fetchJson URLs) tests
// exactly what the page consumes without coupling this test to that
// internal fan-out.
const MOCK_DASHBOARD = {
  kpis: [
    { label: "Active users", value: 24 },
    { label: "Modules", value: 6 },
    { label: "Health", value: "OK" },
    { label: "Readiness", value: "88/100" },
  ],
  health: { status: "ok", services: [] },
  readiness: null,
  modules: [{ name: "Finance" }, { name: "HR" }],
};

function mockDashboard(result: { data: unknown; source: "api" | "error" }) {
  getTenantAdminDashboardMock.mockResolvedValue(result);
}

describe("TenantAdminPage", () => {
  beforeEach(() => { getTenantAdminDashboardMock.mockReset(); mockRoles = ["platform_admin"]; });

  it("renders real KPI values when the loader succeeds", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    expect(screen.getByText("Active users").closest(".stat")).toHaveTextContent("24");
    expect(screen.getByText("Modules").closest(".stat")).toHaveTextContent("6");
  });

  it("renders — for every KPI, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here but only wired to
    // the DataSourceBadge -- never to the KPI values.
    mockDashboard({
      data: { ...MOCK_DASHBOARD, kpis: MOCK_DASHBOARD.kpis.map((k) => ({ ...k, value: 0 })) },
      source: "error",
    });
    render(await TenantAdminPage({}));
    expect(screen.getByText("Active users").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Modules").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-TENANT-ADMIN-HOME-02: on load failure the health card shows a retry state, not a false 'down'", async () => {
    mockDashboard({
      data: { ...MOCK_DASHBOARD, health: { status: "down", services: [] }, modules: [] },
      source: "error",
    });
    render(await TenantAdminPage({}));
    // No "down" pill — a transient outage must not read as a platform outage.
    expect(screen.queryByText("down")).not.toBeInTheDocument();
    // The retry error copy is shown instead (RefreshErrorState / toHumanError).
    expect(screen.getByText(/couldn't load service health/i)).toBeInTheDocument();
    // The modules card must not say "No modules" on error either.
    expect(screen.queryByText("No modules")).not.toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-HOME-04: enabled-modules card reads 'enabled' and shows no per-module 'Active' pill", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    expect(screen.getByText(/2 enabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/configured/i)).not.toBeInTheDocument();
    // The unconditional "Active" pill per module is gone.
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    // Module names still render.
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-HOME-01: the audit action is an honest 'View audit log' link with no export query", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    const link = screen.getByRole("link", { name: /view audit log/i });
    expect(link).toHaveAttribute("href", "/tenant-admin/audit");
    expect(screen.queryByText(/export report/i)).not.toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-HOME-03: the Invite user CTA deep-links to the users invite flow", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    const invite = screen.getByRole("link", { name: /invite user/i });
    expect(invite).toHaveAttribute("href", "/tenant-admin/users?invite=1");
  });

  it("GAP-TENANT-ADMIN-HOME-05: a platform_admin session sees the Platform Config tile", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    expect(screen.getByRole("link", { name: /Platform Config/i })).toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-HOME-05: a plain tenant_admin does NOT see the platform-only Platform Config tile", async () => {
    mockRoles = ["tenant_admin"];
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage({}));
    expect(screen.queryByRole("link", { name: /Platform Config/i })).not.toBeInTheDocument();
    // A non-gated tile is still visible.
    expect(screen.getByRole("link", { name: /Users/i })).toBeInTheDocument();
  });
});
