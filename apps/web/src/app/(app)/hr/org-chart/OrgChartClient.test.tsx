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

// HIGH-6 (a11y remediation): OrgTreeNode already implemented role="tree" /
// role="group" correctly, but had no roving-tabindex or ArrowUp/ArrowDown/
// Home/End — the core required WAI-ARIA tree keyboard interaction. These
// tests exercise the roving-focus wiring that lives here in OrgChartClient
// (visibleOrder / activeId / onNavigate), since that's where the fix's
// visible-node traversal logic actually lives.
describe("org-chart/OrgChartClient keyboard tree navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Root "Alice" auto-expands (initial `expanded` seeds every root id), so
  // her direct children "Bob" and "Dave" are visible immediately. "Bob"'s
  // own child "Carol" starts collapsed — only Bob himself is initially
  // expanded once the test drives it open.
  const TREE: OrgChartNode[] = [
    {
      id: "root",
      name: "Alice",
      designation: "Secretary",
      department: "HR",
      reportsTo: null,
      children: [
        {
          id: "child-a",
          name: "Bob",
          designation: "Officer",
          department: "HR",
          children: [
            { id: "grandchild", name: "Carol", designation: "Clerk", department: "HR" },
          ],
        },
        { id: "child-b", name: "Dave", designation: "Officer", department: "HR" },
      ],
    },
  ];

  function treeitem(name: RegExp) {
    return screen.getByRole("treeitem", { name });
  }

  it("gives exactly one treeitem tabIndex 0 on initial render (the first root)", () => {
    render(<OrgChartClient data={TREE} />);
    expect(treeitem(/Alice/)).toHaveAttribute("tabindex", "0");
    expect(treeitem(/Bob/)).toHaveAttribute("tabindex", "-1");
    expect(treeitem(/Dave/)).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowDown moves DOM focus and the roving tabindex to the next visible treeitem", () => {
    render(<OrgChartClient data={TREE} />);
    treeitem(/Alice/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(treeitem(/Bob/));
    expect(treeitem(/Bob/)).toHaveAttribute("tabindex", "0");
    expect(treeitem(/Alice/)).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowDown skips a collapsed node's children, then reaches them once expanded", () => {
    render(<OrgChartClient data={TREE} />);
    treeitem(/Bob/).focus();
    // Bob is collapsed: Down should land on Dave, not the hidden Carol.
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(treeitem(/Dave/));

    // Expand Bob (Enter), then Down from Bob should now reach Carol.
    treeitem(/Bob/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    fireEvent.keyDown(treeitem(/Bob/), { key: "ArrowDown" });
    expect(document.activeElement).toBe(treeitem(/Carol/));
  });

  it("ArrowUp moves focus to the previous visible treeitem", () => {
    render(<OrgChartClient data={TREE} />);
    treeitem(/Dave/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(treeitem(/Bob/));
  });

  it("Home jumps to the first visible treeitem and End to the last", () => {
    render(<OrgChartClient data={TREE} />);
    treeitem(/Bob/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(treeitem(/Dave/));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(treeitem(/Alice/));
  });

  it("ArrowDown/Up at the last/first visible treeitem stay in place instead of throwing", () => {
    render(<OrgChartClient data={TREE} />);
    treeitem(/Alice/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(treeitem(/Alice/));

    treeitem(/Dave/).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(treeitem(/Dave/));
  });
});
