import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const requireAnyRoleMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: (...a: unknown[]) => requireAnyRoleMock(...a),
}));

const getAdminOperationsDashboardMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getAdminOperationsDashboard: (...a: unknown[]) => getAdminOperationsDashboardMock(...a) };
});

import AdminOperationsPage from "./page";

function dashboard(over: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-09-01T06:30:00Z",
    pm2Available: true,
    summary: { totalProcesses: 10, onlineProcesses: 8, workersOnline: 3, workersTotal: 3, failedJobs: 99, outboxPending: 0, queueHealthy: true },
    processes: [
      { name: "web", kind: "service", status: "online", restarts: 0, cpuPct: 1, memoryMb: 100, uptimeSeconds: 100 },
      { name: "worker-1", kind: "worker", status: "online", restarts: 0, cpuPct: 1, memoryMb: 100, uptimeSeconds: 100 },
    ],
    queue: { healthy: true, detail: "ok" },
    schedulers: [{ name: "cron-1", ownerProcess: "worker-1", schedule: "* * * * *", status: "online", lastObservedAt: "2026-09-01T06:00:00Z" }],
    outbox: { pending: 0 },
    recentErrors: [],
    externalMonitorRecommendation: [{ tool: "Uptime", purpose: "ping" }],
    ...over,
  };
}

describe("AdminOperationsPage", () => {
  beforeEach(() => {
    requireAnyRoleMock.mockReset();
    getAdminOperationsDashboardMock.mockReset();
  });

  // GAP-TENANT-ADMIN-OPERATIONS-01
  it("redirects a non-platform admin with a reason (?denied=operations)", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({ data: dashboard(), source: "api" });
    await AdminOperationsPage();
    expect(requireAnyRoleMock).toHaveBeenCalledWith(["platform_admin", "super_admin"], "/tenant-admin?denied=operations");
  });

  // GAP-TENANT-ADMIN-OPERATIONS-03: Processes Not Online = total - online (not failedJobs=99).
  it("shows Processes Not Online derived from totals, not the ambiguous failedJobs", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({ data: dashboard(), source: "api" });
    render(await AdminOperationsPage());
    expect(screen.getByText("Processes Not Online").closest(".stat")).toHaveTextContent("2");
    expect(screen.queryByText("99")).not.toBeInTheDocument();
  });

  // GAP-TENANT-ADMIN-OPERATIONS-02: PM2 unavailable -> dependent checks are "Not reported", not failed.
  it("treats PM2-unavailable checks as Not reported, not failing", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({
      data: dashboard({ pm2Available: false }),
      source: "api",
    });
    render(await AdminOperationsPage());
    expect(screen.getByText(/Not reported/i)).toBeInTheDocument();
    // "Checks passing" denominator excludes the unknown checks (fewer than 8)
    const card = screen.getByText("Checks passing").closest(".stat")!;
    expect(card.textContent).toMatch(/\/\s*[1-7]\b/);
  });

  // GAP-TENANT-ADMIN-OPERATIONS-05: last-checked carries an IST label.
  it("renders the last-checked time with an IST label", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({ data: dashboard(), source: "api" });
    render(await AdminOperationsPage());
    expect(screen.getAllByText(/IST/).length).toBeGreaterThanOrEqual(1);
  });

  // GAP-TENANT-ADMIN-OPERATIONS-05: alerting card renamed.
  it("names the monitoring card 'Recommended external monitoring'", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({ data: dashboard(), source: "api" });
    render(await AdminOperationsPage());
    expect(screen.getByText("Recommended external monitoring")).toBeInTheDocument();
    expect(screen.queryByText(/^External alerting$/)).not.toBeInTheDocument();
  });

  // GAP-TENANT-ADMIN-OPERATIONS-05: distinct empty states for services vs workers.
  it("shows distinct empty states for service vs worker tables when there are none", async () => {
    getAdminOperationsDashboardMock.mockResolvedValue({ data: dashboard({ processes: [] }), source: "api" });
    render(await AdminOperationsPage());
    expect(screen.getByText("No service processes reported")).toBeInTheDocument();
    expect(screen.getByText("No worker processes reported")).toBeInTheDocument();
  });
});
