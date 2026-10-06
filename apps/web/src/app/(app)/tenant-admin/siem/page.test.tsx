import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getSiemAlerts } = vi.hoisted(() => ({ getSiemAlerts: vi.fn() }));
vi.mock("@/app/_data/loaders", () => ({ getSiemAlerts: () => getSiemAlerts() }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));

import SiemPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("SiemPage (GAP-TENANT-ADMIN-SIEM-01/03/05)", () => {
  it("subtitle no longer promises blocked IPs or 'Real-time'", async () => {
    getSiemAlerts.mockResolvedValue({ source: "api", data: [] });
    const ui = await SiemPage();
    render(ui);
    expect(document.body.textContent).not.toMatch(/blocked IPs/i);
    expect(document.body.textContent).not.toMatch(/Real-time threat intelligence/i);
    expect(document.body.textContent).toMatch(/Near real-time/i);
  });

  it("counts open lifecycle states (detected/triaged/contained) as Active", async () => {
    getSiemAlerts.mockResolvedValue({
      source: "api",
      data: [
        { id: "a1", timestamp: "2026-09-29T00:00:00Z", title: "x", severity: "critical", source: "auth", status: "detected" },
        { id: "a2", timestamp: "2026-09-29T00:00:00Z", title: "y", severity: "high", source: "net", status: "triaged" },
        { id: "a3", timestamp: "2026-09-29T00:00:00Z", title: "z", severity: "low", source: "net", status: "resolved" },
      ],
    });
    const ui = await SiemPage();
    render(ui);
    // Active Alerts tile value should be 2 (detected + triaged), not counting resolved.
    expect(document.body.textContent).toContain("Active Alerts");
    // Find a tile showing 2.
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });
});
