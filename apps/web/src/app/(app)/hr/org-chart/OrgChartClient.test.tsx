import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OrgChartNode } from "@civitasone/types";
import { OrgChartClient } from "./OrgChartClient";

const DATA: OrgChartNode[] = [
  { id: "1", name: "Alice", designation: "Secretary", department: "HR", reportsTo: null },
];

// UX-008 tranche 2: the toolbar (Expand all / Collapse all / Print) used an
// ad hoc `toolbarBtn` inline-style object (no shared design-system class) --
// converted onto the shared Button component. No prior test existed for this
// file, so this covers that each control's click handler still fires.
describe("org-chart/OrgChartClient toolbar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Each control carries its own `aria-label` (e.g. "Expand all nodes"),
  // which takes precedence over its visible emoji+text content for the
  // accessible name -- this is pre-existing markup the conversion preserved
  // as-is, so these query by the aria-label text, not the visible label.

  it("renders the toolbar buttons even with no chart data", () => {
    render(<OrgChartClient data={[]} />);
    expect(screen.getByRole("button", { name: "Expand all nodes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all nodes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print or export org chart as PDF" })).toBeInTheDocument();
    expect(screen.getByText("No organisational hierarchy data available.")).toBeInTheDocument();
  });

  it("Print / PDF calls window.print", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<OrgChartClient data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: "Print or export org chart as PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("Expand all and Collapse all do not throw and stay clickable", () => {
    render(<OrgChartClient data={DATA} />);
    const expandBtn = screen.getByRole("button", { name: "Expand all nodes" });
    const collapseBtn = screen.getByRole("button", { name: "Collapse all nodes" });
    fireEvent.click(expandBtn);
    fireEvent.click(collapseBtn);
    expect(expandBtn).toBeEnabled();
    expect(collapseBtn).toBeEnabled();
  });
});
