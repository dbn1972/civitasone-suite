import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HRDashboardLoading from "./loading";

/**
 * GAP-HR-DASHBOARD-09: the real page only ever renders an sr-only <h1>
 * (page.tsx), so the loading skeleton must not show a visible title either --
 * the old one rendered "HR Dashboard" and then lost it the instant data
 * arrived. It must also mirror the real layout (6-card KPI strip, 3-column
 * body) so nothing jumps when the page swaps in.
 */
describe("HRDashboardLoading", () => {
  it("shows no visible header or title text", () => {
    const { container } = render(<HRDashboardLoading />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(container.textContent?.trim()).toBe("");
  });

  it("mirrors the real layout: six KPI cards, then a three-column body", () => {
    const { container } = render(<HRDashboardLoading />);
    const root = container.firstElementChild as HTMLElement;
    const grids = (Array.from(root.children) as HTMLElement[]).filter((d) => d.style.display === "grid");
    expect(grids.map((g) => g.style.gridTemplateColumns)).toEqual(["repeat(6, 1fr)", "1fr 260px 220px"]);
    expect(grids[0]!.children).toHaveLength(6);
    expect(grids[1]!.children).toHaveLength(3);
  });
});
