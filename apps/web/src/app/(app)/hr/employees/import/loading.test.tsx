import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Loading from "./loading";

/** GAP-HR-EMPLOYEES-IMPORT-07 (acceptance: "loading state shows two card skeletons"). */
describe("Bulk import Loading", () => {
  it("shows the real page header and exactly two card skeletons, not the old dashboard shape", async () => {
    const { container } = render(await Loading());
    expect(screen.getByRole("heading", { name: "Bulk Employee Import" })).toBeInTheDocument();
    const cards = container.querySelectorAll('[data-testid="import-skeleton-card"]');
    expect(cards).toHaveLength(2);
  });

  it("the first card is a six-row table skeleton", async () => {
    const { container } = render(await Loading());
    const first = container.querySelectorAll('[data-testid="import-skeleton-card"]')[0] as HTMLElement;
    expect(within(first).getAllByTestId("import-skeleton-row")).toHaveLength(6);
  });

  it("is a busy, polite status region with no KPI tile row", async () => {
    const { container } = render(await Loading());
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    // The old skeleton drew four 80px KPI tiles in an auto-fit grid.
    expect(container.querySelector('[style*="repeat(auto-fit"]')).toBeNull();
  });
});
