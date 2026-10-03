import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { TechAdminTable } from "./TechAdminTable";

const rows = [
  { serviceName: "hrms", port: 3001, dbConnections: 4, memory: 536870912, uptime: 90061, status: "running" },
  { serviceName: "finance", port: 3002, dbConnections: 2, memory: 100, uptime: 5, status: "stopped" },
  { serviceName: "audit", port: 3003, dbConnections: 1, memory: 100, uptime: 5, status: "degraded" },
  { serviceName: "weird", port: 3004, dbConnections: 1, memory: 100, uptime: 5, status: "foo" },
];

function tile(label: string) {
  return screen.getByText(label, { selector: ".lab" }).parentElement as HTMLElement;
}

describe("TechAdminTable (GAP-ADMIN-TECH-ADMIN-02/-03/-04/-05)", () => {
  beforeEach(() => { refresh.mockReset(); seeded.mockReset(); });

  it("colour-codes status, counts degraded explicitly, and buckets unknown separately", () => {
    seeded.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null });
    render(<TechAdminTable services={rows} fetchedAt="2026-10-03T06:00:00.000Z" />);
    expect(screen.getAllByText("Running").some((e) => e.classList.contains("pill") && e.classList.contains("good"))).toBe(true);
    expect(screen.getByText("Stopped", { selector: ".pill" })).toHaveClass("bad");
    expect(screen.getByText("Degraded", { selector: ".pill" })).toHaveClass("warn");
    expect(tile("Degraded")).toHaveTextContent("1");
    expect(tile("Unknown status")).toHaveTextContent("1");
    expect(tile("Services")).toHaveTextContent("4");
  });

  it("derives tiles from the rows the hook returns (cached copy), not the empty server list", () => {
    seeded.mockReturnValue({ data: rows, provenance: "cached", offline: false, cachedAt: "2026-10-02T00:00:00.000Z" });
    render(<TechAdminTable services={[]} source="error" />);
    expect(tile("Services")).toHaveTextContent("4");
    expect(tile("Running")).toHaveTextContent("1");
  });

  it("shows dashes (not 0) when there is no data and no cache", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<TechAdminTable services={[]} source="error" />);
    expect(tile("Services")).toHaveTextContent("—");
    expect(tile("Running")).toHaveTextContent("—");
    expect(tile("Degraded")).not.toHaveTextContent("0");
  });

  it("formats memory/uptime and offers Refresh with a checked time", () => {
    seeded.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null });
    render(<TechAdminTable services={rows} fetchedAt="2026-10-03T06:00:00.000Z" />);
    expect(screen.getByText("512 MB")).toBeInTheDocument();
    expect(screen.getByText("1d 1h")).toBeInTheDocument();
    expect(screen.getByText(/Checked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
