import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderWithIntl } from "@/lib/testUtils/intl";
import ServiceRequestsLoading from "./loading";

/**
 * GAP-CRM-SERVICE-REQUESTS-06: the skeleton must mirror the loaded page so nothing jumps when the data
 * arrives. The loaded page grew a fifth tile (Cancelled, GAP-CRM-SERVICE-REQUESTS-05) while the skeleton
 * kept SkeletonTable's default of four, so the tile row changed shape on load. The skeleton tile count is
 * pinned to the number of StatCards the page renders.
 */
describe("GAP-CRM-SERVICE-REQUESTS-06 service requests loading skeleton", () => {
  it("renders as many skeleton tiles as the loaded page renders stat tiles, plus the table outline", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    const pageTiles = (page.match(/<StatCard\b/g) ?? []).length;
    expect(pageTiles).toBeGreaterThan(0);

    const { container } = renderWithIntl(<ServiceRequestsLoading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    const grid = container.querySelector<HTMLElement>('div[style*="repeat("]');
    expect(grid).not.toBeNull();
    const columns = Number(/repeat\((\d+),/.exec(grid!.getAttribute("style") ?? "")?.[1]);
    expect(columns).toBe(pageTiles);
    expect(grid!.children).toHaveLength(pageTiles);
  });

  it("paints with theme tokens, not a hard-coded slate block (dark mode follows the theme)", () => {
    const { container } = renderWithIntl(<ServiceRequestsLoading />);
    expect(container.innerHTML).not.toContain("slate-200");
    expect(container.innerHTML).toContain("var(--line2)");
  });
});
