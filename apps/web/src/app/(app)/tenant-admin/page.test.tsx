import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getTenantAdminDashboardMock = vi.fn();
vi.mock("../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../_data/loaders")>("../../_data/loaders");
  return { ...actual, getTenantAdminDashboard: (...args: unknown[]) => getTenantAdminDashboardMock(...args) };
});
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["platform_admin"],
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
  beforeEach(() => getTenantAdminDashboardMock.mockReset());

  it("renders real KPI values when the loader succeeds", async () => {
    mockDashboard({ data: MOCK_DASHBOARD, source: "api" });
    render(await TenantAdminPage());
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
    render(await TenantAdminPage());
    expect(screen.getByText("Active users").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Modules").closest(".stat")).toHaveTextContent("—");
  });
});
