import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import { ApiMonitoringTable } from "./ApiMonitoringTable";

const row = (status: string, service = "svc") => ({ service, endpoint: "/v1/x", p95Latency: 12, errorRate: 0.1, requestsPerMin: 5, status });
const statValue = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains("lab"))?.parentElement?.querySelector(".val")?.textContent;

describe("ApiMonitoringTable", () => {
  beforeEach(() => resourceMock.mockReset());

  // GAP-ADMIN-API-MONITORING-02: server failed, cached rows shown -> cards must agree with the table.
  it("cards count the cached rows the table shows, not zero", () => {
    resourceMock.mockReturnValue({
      data: [row("healthy", "a"), row("degraded", "b"), row("down", "c"), row("maintenance", "d")],
      provenance: "cached", offline: false, cachedAt: "2026-09-01T00:00:00Z", fromCache: true,
    });
    render(<ApiMonitoringTable endpoints={[]} source="error" status={500} />);
    expect(statValue("Endpoints")).toBe("4");
    expect(statValue("Healthy")).toBe("1");
    expect(statValue("Down")).toBe("1");
    expect(statValue("Unknown / other")).toBe("1");
    expect(screen.getByText(/Showing saved data/)).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  // GAP-ADMIN-API-MONITORING-03
  it("error with nothing cached -> retry state, dash cards, no empty-table text", () => {
    resourceMock.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null, fromCache: false });
    render(<ApiMonitoringTable endpoints={[]} source="error" status={500} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(statValue("Endpoints")).toBe("—");
    expect(statValue("Down")).toBe("—");
    expect(screen.queryByText("No API data")).not.toBeInTheDocument();
  });

  it("403 -> Access restricted, no retry button", () => {
    resourceMock.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null, fromCache: false });
    render(<ApiMonitoringTable endpoints={[]} source="error" status={403} errorMessage="requires super_admin" />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("a genuine empty result keeps the table's empty state and real zeros", () => {
    resourceMock.mockReturnValue({ data: [], provenance: "live", offline: false, cachedAt: null, fromCache: false });
    render(<ApiMonitoringTable endpoints={[]} source="api" status={200} />);
    expect(screen.getByText("No API data")).toBeInTheDocument();
    expect(statValue("Endpoints")).toBe("0");
  });
});
