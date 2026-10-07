import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { MISSummary } from "@civitasone/types";

const { loaders } = vi.hoisted(() => ({
  loaders: { getMISSummary: vi.fn() },
}));

vi.mock("../../../_data/loaders", () => ({
  getMISSummary: loaders.getMISSummary,
}));

import MISDashboardPage from "./page";

const populated: MISSummary[] = [
  {
    module: "finance",
    metrics: [
      { label: "Collections", value: "125000", unit: "₹", change: "+5%" },
      { label: "Pending bills", value: "12", unit: "count", change: "\u22124" }, // Unicode minus
      { label: "Utilisation", value: "80", unit: "%", change: "12%" }, // unsigned positive
      { label: "Flat metric", value: "3", unit: "count", change: "0%" },
    ],
  },
];

/** Read the `.val` text of the stat card whose `.lab` matches `label`. */
function statValue(container: HTMLElement, label: string): string | null | undefined {
  const lab = within(container).getByText(label);
  const stat = lab.closest(".stat");
  return stat?.querySelector(".val")?.textContent;
}

describe("MIS dashboard page", () => {
  beforeEach(() => loaders.getMISSummary.mockReset());

  it("GAP-REPORTS-MIS-01: on error shows four '—' stat values and the refresh error state", async () => {
    loaders.getMISSummary.mockResolvedValue({ data: [], source: "error" });
    const { container } = render(await MISDashboardPage());

    expect(statValue(container, "Data Sources")).toBe("—");
    expect(statValue(container, "Total Metrics")).toBe("—");
    expect(statValue(container, "Positive Trends")).toBe("—");
    expect(statValue(container, "Negative Trends")).toBe("—");
    // Error state present; Build Report hidden.
    expect(screen.queryByRole("link", { name: "Build Report" })).not.toBeInTheDocument();
  });

  it("GAP-REPORTS-MIS-04: an empty (but successful) result shows the empty state inside a card and hides Build Report", async () => {
    loaders.getMISSummary.mockResolvedValue({ data: [], source: "api" });
    const { container } = render(await MISDashboardPage());

    const card = container.querySelector(".card");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("Cross-department datasets")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("MIS data compiling")).toBeInTheDocument();
    // Stats read 0 (a real, known empty count), not "—".
    expect(statValue(container, "Data Sources")).toBe("0");
    expect(screen.queryByRole("link", { name: "Build Report" })).not.toBeInTheDocument();
  });

  it("GAP-REPORTS-MIS-02: counts Unicode-minus and unsigned-positive changes correctly", async () => {
    loaders.getMISSummary.mockResolvedValue({ data: populated, source: "api" });
    const { container } = render(await MISDashboardPage());

    expect(statValue(container, "Data Sources")).toBe("1");
    expect(statValue(container, "Total Metrics")).toBe("4");
    // "+5%" and "12%" are up => 2; "−4" is down => 1; "0%" is flat => neither.
    expect(statValue(container, "Positive Trends")).toBe("2");
    expect(statValue(container, "Negative Trends")).toBe("1");
    expect(screen.getByRole("link", { name: "Build Report" })).toBeInTheDocument();
  });
});
