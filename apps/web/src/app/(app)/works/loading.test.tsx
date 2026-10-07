import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Loading from "./loading";

/**
 * GAP-WORKS-HOME-04: the skeleton must mirror the hub (5 StatCards + 8 module
 * tiles) so there is no layout jump when real content lands. The old skeleton
 * painted four KPI blocks and a single tall bar.
 */
describe("WorksHub loading skeleton", () => {
  it("renders five stat placeholders and an eight-tile grid (matching the hub)", () => {
    const { container } = render(<Loading />);
    const grids = container.querySelectorAll('div[style*="grid"]');
    expect(grids.length).toBe(2);
    const statGrid = grids[0];
    const tileGrid = grids[1];
    expect(statGrid.children.length).toBe(5);
    expect(tileGrid.children.length).toBe(8);
  });

  it("exposes a loading status region for assistive tech", () => {
    const { getByRole } = render(<Loading />);
    expect(getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });
});
