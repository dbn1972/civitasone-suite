import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The page is now role-gated (platform operators only); render as one.
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import SaDashboardPage from "./page";

type LoaderResult = { data: unknown; source: "api" | "error" };

/**
 * The page fetches two independent resources (getSADashboard +
 * getSAOperationsSnapshot). Route each by the path fetchJson was called
 * with, exactly like analytics/kpi/page.test.tsx does for a single loader.
 */
function mockLoaders(opts: { dashboard?: LoaderResult; operations?: LoaderResult } = {}) {
  const dashboard = opts.dashboard ?? { data: {}, source: "error" as const };
  const operations = opts.operations ?? { data: {}, source: "error" as const };
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/admin/sa-dashboard")) return Promise.resolve(dashboard);
    if (typeof path === "string" && path.includes("/admin/operations")) return Promise.resolve(operations);
    return Promise.resolve({ data: {}, source: "api" });
  });
}

describe("SaDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real tenant/user/uptime/service figures when every loader succeeds", async () => {
    mockLoaders({
      dashboard: { data: { activeTenants: 12, totalUsers: 340, uptime: "99.97%" }, source: "api" },
      operations: { data: { pm2Available: true, summary: { onlineProcesses: 33, totalProcesses: 33 } }, source: "api" },
    });
    render(await SaDashboardPage());
    expect(screen.getByText("Active Tenants").parentElement).toHaveTextContent("12");
    expect(screen.getByText("Total Users").parentElement).toHaveTextContent("340");
    expect(screen.getByText("Platform Uptime").parentElement).toHaveTextContent("99.97%");
    expect(screen.getByText("Services").parentElement).toHaveTextContent("33/33");
  });

  // Regression test for the audit finding: this page used to hardcode
  // `value="33"` for Services (never wired to any loader) and fall back to
  // a literal `"99.9%"` for Platform Uptime whenever dashboard.uptime was
  // missing — which, since GET /api/v1/admin/sa-dashboard has no matching
  // backend route at all, was actually every single load. Both rendered
  // with full visual confidence next to the same fetch's own honest
  // "Couldn't load" / "No metrics" failure copy.
  it("never fabricates 99.9% uptime or a hardcoded 33 services count when both loaders fail", async () => {
    mockLoaders({
      dashboard: { data: {}, source: "error" },
      operations: { data: {}, source: "error" },
    });
    render(await SaDashboardPage());
    expect(screen.getByText("Platform Uptime").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Services").parentElement).toHaveTextContent("—");
    expect(screen.queryByText("99.9%")).not.toBeInTheDocument();
    expect(screen.queryByText("33")).not.toBeInTheDocument();
    // Companion fix (GET /v1/admin/sa-dashboard, previously a 404 on every
    // load): Total Users used to coerce a missing/failed totalUsers to a
    // fabricated "0" via `Number(dashboard.totalUsers ?? 0)`. The backend
    // now returns an honest `null` when no cross-tenant user count exists
    // (see admin-service's sa-dashboard.ts), and this tile must show "—",
    // never "0", for that same reason.
    expect(screen.getByText("Total Users").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Total Users").parentElement).not.toHaveTextContent("0");
    // The KPI table's own honest failure copy is untouched by this fix.
    // (GAP-ADMIN-SA-DASHBOARD-05: a failed fetch now says so instead of "No metrics".)
    expect(screen.getByText("Couldn't load metrics")).toBeInTheDocument();
  });

  it("shows a real online/declared count from the live PM2 operations snapshot even when the separate sa-dashboard API fails", async () => {
    mockLoaders({
      dashboard: { data: {}, source: "error" },
      operations: { data: { pm2Available: true, summary: { onlineProcesses: 8, totalProcesses: 33 } }, source: "api" },
    });
    render(await SaDashboardPage());
    expect(screen.getByText("Services").parentElement).toHaveTextContent("8/33");
    // Uptime has no real backing telemetry anywhere yet and stays honest
    // regardless of what the (unrelated) operations snapshot reports.
    expect(screen.getByText("Platform Uptime").parentElement).toHaveTextContent("—");
  });

  it("treats an unreachable PM2 as unavailable, not a confirmed zero (pm2Available: false must not render as '0/18 online')", async () => {
    mockLoaders({
      dashboard: { data: {}, source: "error" },
      operations: { data: { pm2Available: false, summary: { onlineProcesses: 0, totalProcesses: 18 } }, source: "api" },
    });
    render(await SaDashboardPage());
    expect(screen.getByText("Services").parentElement).toHaveTextContent("—");
    expect(screen.queryByText("0/18")).not.toBeInTheDocument();
  });

  // GAP-ADMIN-SA-DASHBOARD-01
  it("shows '—' (not a fabricated 0) when activeTenants is missing, and a real 0 when the API says 0", async () => {
    mockLoaders({ dashboard: { data: {}, source: "api" } });
    render(await SaDashboardPage());
    expect(screen.getByText("Active Tenants").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Active Tenants").parentElement).not.toHaveTextContent("0");
  });

  it("renders a genuine zero tenant count as 0", async () => {
    mockLoaders({ dashboard: { data: { activeTenants: 0 }, source: "api" } });
    render(await SaDashboardPage());
    expect(screen.getByText("Active Tenants").parentElement).toHaveTextContent("0");
  });
});

describe("SaDashboardPage - honest copy and unavailable-figure notes (GAP-ADMIN-SA-DASHBOARD-02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("the subtitle no longer promises revenue or growth", async () => {
    mockLoaders({ dashboard: { data: { activeTenants: 1 }, source: "api" }, operations: { data: { pm2Available: true, summary: {} }, source: "api" } });
    render(await SaDashboardPage());
    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument();
    expect(screen.getByText(/tenants, users, uptime and service status/i)).toBeInTheDocument();
  });

  it("explains in text which tiles are unavailable, not just with a dash", async () => {
    mockLoaders({ dashboard: { data: { activeTenants: 1 }, source: "api" }, operations: { data: { pm2Available: true, summary: { onlineProcesses: 1, totalProcesses: 1 } }, source: "api" } });
    render(await SaDashboardPage());
    expect(screen.getByText(/Total Users and Platform Uptime are not reported by the platform yet/i)).toBeInTheDocument();
  });

  it("shows no notes or badges when everything is reported", async () => {
    mockLoaders({
      dashboard: { data: { activeTenants: 2, totalUsers: 5, uptime: "99.9%" }, source: "api" },
      operations: { data: { pm2Available: true, summary: { onlineProcesses: 3, totalProcesses: 3 } }, source: "api" },
    });
    render(await SaDashboardPage());
    expect(screen.queryByLabelText("Unavailable figures")).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not reachable/i)).not.toBeInTheDocument();
  });

  it("shows a visible message when the operations fetch fails, distinct from an unreachable service manager", async () => {
    mockLoaders({ dashboard: { data: { activeTenants: 2, totalUsers: 5, uptime: "99%" }, source: "api" }, operations: { data: {}, source: "error" } });
    const { unmount } = render(await SaDashboardPage());
    expect(screen.getAllByText("Service status could not be loaded")).toHaveLength(1); // one message, not a badge plus a note
    expect(screen.queryByText("Service manager not reachable")).not.toBeInTheDocument();
    unmount();
    mockLoaders({ dashboard: { data: { activeTenants: 2, totalUsers: 5, uptime: "99%" }, source: "api" }, operations: { data: { pm2Available: false, summary: {} }, source: "api" } });
    render(await SaDashboardPage());
    expect(screen.getAllByText("Service manager not reachable").length).toBeGreaterThan(0);
  });
});
