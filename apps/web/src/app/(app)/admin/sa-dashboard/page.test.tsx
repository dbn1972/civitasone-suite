import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
    // The KPI table's own honest failure copy is untouched by this fix.
    expect(screen.getByText("No metrics")).toBeInTheDocument();
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
});
