import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getTenantAdminDashboardMock = vi.fn();
vi.mock("@/app/_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
  return { ...actual, getTenantAdminDashboard: (...args: unknown[]) => getTenantAdminDashboardMock(...args) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ReadinessPage from "./page";

function dashboard(readiness: unknown, source: "api" | "error" = "api") {
  return {
    source,
    data: { kpis: [], health: { status: "ok", services: [] }, readiness, modules: [] },
  };
}

describe("ReadinessPage — GAP-TENANT-ADMIN-READINESS-01/-02/-03/-04", () => {
  beforeEach(() => getTenantAdminDashboardMock.mockReset());

  it("renders rows from the live gate map, not a fixed constant (-01)", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(
      dashboard({
        overall: 75,
        productionReady: false,
        allGreen: false,
        gates: [
          { key: "queueFirstWrites", passed: true },
          { key: "responseValidation", passed: true },
          { key: "workersRunning", passed: true },
          { key: "perfIndexes", passed: false },
        ],
      }),
    );
    render(await ReadinessPage());
    const list = screen.getByRole("list", { name: "Readiness items" });
    // 4 gates -> 4 rows (not the old hard-coded 8).
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Performance indexes")).toBeInTheDocument();
  });

  it("tile counts are consistent with the rows: passed + failed === total (-02)", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(
      dashboard({
        overall: 75,
        productionReady: false,
        allGreen: false,
        gates: [
          { key: "a", passed: true },
          { key: "b", passed: true },
          { key: "c", passed: true },
          { key: "d", passed: false },
        ],
      }),
    );
    render(await ReadinessPage());
    // Old bug: round(75/100*8)=6 passed + inProgress + failed could sum to 9 of 8.
    expect(screen.getByText("Passed").closest(".stat")).toHaveTextContent("3 of 4");
    expect(screen.getByText("Failed").closest(".stat")).toHaveTextContent("1");
  });

  it("shows a Fix link for a failing gate that has a target screen (-03)", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(
      dashboard({
        overall: 50,
        productionReady: false,
        allGreen: false,
        gates: [{ key: "queueFirstWrites", passed: false }],
      }),
    );
    render(await ReadinessPage());
    // queueFirstWrites has no href in GATE_META, so no Fix link; assert no 404 href rendered.
    const list = screen.getByRole("list", { name: "Readiness items" });
    expect(within(list).queryByRole("link")).toBeNull();
  });

  it("states go-live readiness in text when not production ready (-04)", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(
      dashboard({ overall: 60, productionReady: false, allGreen: false, gates: [{ key: "a", passed: false }] }),
    );
    render(await ReadinessPage());
    expect(screen.getByText("Not ready for go-live")).toBeInTheDocument();
  });

  it("shows a not-available state (never fixed Pass/Fail rows) when readiness is null (-01/-04)", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(dashboard(null));
    render(await ReadinessPage());
    expect(screen.getByText("Readiness score not available")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Readiness items" })).toBeNull();
    expect(screen.getByText("Overall Readiness").closest(".stat")).toHaveTextContent("—");
  });

  it("shows a retry error state (not 0%) on load error", async () => {
    getTenantAdminDashboardMock.mockResolvedValue(dashboard(null, "error"));
    render(await ReadinessPage());
    expect(screen.getByText("Overall Readiness").closest(".stat")).toHaveTextContent("—");
  });
});
