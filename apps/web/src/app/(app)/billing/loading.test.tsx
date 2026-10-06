import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BillingLoading from "./loading";

// GAP-BILLING-HOME-04: the loaded hub is a ModuleHub (PageHeader + one tile
// grid) with no stat cards or table. The old skeleton drew a 4-card stat grid
// and an h-72 (288px) table block inside a min-h-screen bg-slate-50 wrapper,
// causing a layout shift. These assertions fail on the old loading.tsx.
describe("BillingLoading skeleton", () => {
  it("renders inside the page-main wrapper (like ModuleHub), not a min-h-screen bg-slate-50 shell", () => {
    const { container } = render(<BillingLoading />);
    expect(container.querySelector(".page-main")).toBeInTheDocument();
    expect(container.querySelector(".min-h-screen")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-slate-50")).not.toBeInTheDocument();
  });

  it("shows five tile placeholders in a 3-column grid and no 288px table block", () => {
    const { container } = render(<BillingLoading />);
    const grids = container.querySelectorAll('[style*="repeat(3, 1fr)"]');
    expect(grids.length).toBe(1);
    // five tile placeholders (height 96) in the single section
    const tiles = Array.from(grids[0].children);
    expect(tiles.length).toBe(5);
    // no stale 288px (h-72) table block
    expect(container.querySelector(".h-72")).not.toBeInTheDocument();
  });

  it("marks the skeleton region as busy for assistive tech", () => {
    const { container } = render(<BillingLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });
});
