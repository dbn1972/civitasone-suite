import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Isolate the render logic from the offline cache layer.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial,
    fromCache: false,
    offline: false,
    cachedAt: null,
  }),
}));

import { MonitoringTable } from "./MonitoringTable";

/**
 * L3 truthfulness (money): the Budget Monitoring screen exists to catch
 * over-spend. Its utilisation figure must NOT be capped at 100% — a head at
 * 120% of allocation has to read as 120%, not as "exactly on budget".
 */
describe("MonitoringTable — over-budget utilisation is shown truthfully", () => {
  it("renders the TRUE percentage (120.0%) for an over-committed head, not a capped 100.0%", () => {
    render(
      <MonitoringTable
        lines={[
          {
            headId: "HEAD-OVERSPENT",
            fy: "2026-27",
            allocatedMinor: "10000000",
            actualMinor: "12000000",
            utilisationBps: 12000, // 120.00%
            exception: "projected_overspend",
          },
        ]}
      />,
    );
    expect(screen.getByText(/120\.0%/)).toBeInTheDocument();
    expect(screen.queryByText(/^100\.0%$/)).not.toBeInTheDocument();
    // Not conveyed by colour alone (WCAG): an explicit over-budget label.
    expect(screen.getByText(/over budget/i)).toBeInTheDocument();
  });

  it("shows a normal head's utilisation without an over-budget flag", () => {
    render(
      <MonitoringTable
        lines={[{ headId: "HEAD-OK", fy: "2026-27", utilisationBps: 5000 }]}
      />,
    );
    expect(screen.getByText(/50\.0%/)).toBeInTheDocument();
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
  });
});
