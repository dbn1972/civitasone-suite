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

/** GAP-FINANCE-BUDGET-MONITORING-02: heads are identified by code · name, never by uuid. */
describe("MonitoringTable — head label", () => {
  it("renders the server-joined head label and no uuid text", () => {
    render(<MonitoringTable lines={[{ headId: "9b2f7c1e-0000-4000-8000-000000000001", headCode: "2202", headName: "General Education", fy: "2026-27", utilisationBps: 0 }]} />);
    expect(screen.getByText("2202 · General Education")).toBeInTheDocument();
    expect(screen.queryByText(/9b2f7c1e-0000/)).not.toBeInTheDocument();
  });
  it("renders 'Unknown head' when the head did not resolve", () => {
    render(<MonitoringTable lines={[{ headId: "9b2f7c1e-0000-4000-8000-000000000002", fy: "2026-27", utilisationBps: 0 }]} />);
    expect(screen.getByText("Unknown head")).toBeInTheDocument();
  });
});

// GAP-FINANCE-BUDGET-MONITORING-03/-05
describe("MonitoringTable -- exact money, status/bar agreement", () => {
  it("renders exact paise in the table (allocatedMinor 123456 -> ₹1,234.56)", () => {
    render(<MonitoringTable lines={[{ headId: "h", fy: "2026-27", allocatedMinor: "123456", committedMinor: "0", actualMinor: "99", availableMinor: "123357", utilisationBps: 0 }]} />);
    expect(screen.getByText("₹1,234.56")).toBeInTheDocument();
    expect(screen.getByText("₹0.99")).toBeInTheDocument();
  });

  it("an over_committed row never pairs a green bar with an On Track pill", () => {
    const { container } = render(<MonitoringTable lines={[{ headId: "h", fy: "2026-27", utilisationBps: 3000, exception: "over_committed" }]} />);
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();
    expect(screen.getByText("Over-committed").className).toContain("bad");
    const fill = container.querySelector('div[style*="width: 30%"]') as HTMLElement;
    expect(fill.style.background).toBe("var(--bad)");
  });

  it("a plain low-utilisation head is a green bar with a good On Track pill", () => {
    const { container } = render(<MonitoringTable lines={[{ headId: "h", fy: "2026-27", utilisationBps: 3000, exception: "on_track" }]} />);
    expect(screen.getByText("On Track").className).toContain("good");
    expect((container.querySelector('div[style*="width: 30%"]') as HTMLElement).style.background).toBe("var(--good)");
  });

  it("projected_overspend is at least amber", () => {
    const { container } = render(<MonitoringTable lines={[{ headId: "h", fy: "2026-27", utilisationBps: 1000, exception: "projected_overspend" }]} />);
    expect((container.querySelector('div[style*="width: 10%"]') as HTMLElement).style.background).toBe("var(--warn)");
  });

  it("the utilisation column states its basis (committed + expended)", () => {
    render(<MonitoringTable lines={[{ headId: "h", fy: "2026-27", utilisationBps: 0 }]} />);
    expect(screen.getByText(/Utilisation \(committed \+ expended\)/)).toBeInTheDocument();
  });
});

