import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OrgChartNode } from "@civitasone/types";
import { OrgChartClient } from "./OrgChartClient";

const DATA: OrgChartNode[] = [
  { id: "1", name: "Alice", designation: "Secretary", department: "HR" },
];

// UX-008 tranche 2: the zoom and expand/collapse controls used an ad hoc
// `btnStyle` inline-style object (no shared design-system class) --
// converted onto the shared Button component. No prior test existed for
// this file, so this covers that each control still works post-conversion.
describe("orgchart/OrgChartClient controls", () => {
  it("shows a fallback message and no controls when there is no data", () => {
    render(<OrgChartClient data={[]} />);
    expect(screen.getByText("No organisation chart data available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
  });

  it("zoom in/out/reset update the displayed percentage", () => {
    render(<OrgChartClient data={DATA} />);
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("115%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("85%");

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
  });

  it("Expand all / Collapse all toggle the node's expanded indicator", () => {
    const withChild: OrgChartNode[] = [
      { id: "1", name: "Alice", designation: "Secretary", department: "HR", children: [
        { id: "2", name: "Bob", designation: "Under Secretary", department: "HR" },
      ] },
    ];
    render(<OrgChartClient data={withChild} />);
    expect(screen.getByRole("button", { name: /Alice, Secretary, expanded/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getByRole("button", { name: /Alice, Secretary, collapsed/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByRole("button", { name: /Alice, Secretary, expanded/ })).toBeInTheDocument();
  });
});
