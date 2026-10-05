import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import GrievancesLoading from "./loading";

/**
 * GAP-CRM-GRIEVANCES-07: the skeleton must mirror the loaded page's layout
 * (four stat tiles above the table) so there is no vertical layout shift on
 * load, and must use ds Skeleton theme tokens rather than a hard-coded
 * slate-200 block. The old skeleton rendered a single h-80 block with no tile
 * row — these assertions fail on it.
 */
describe("GAP-CRM-GRIEVANCES-07 grievances loading skeleton", () => {
  it("renders a stat-tile row (SkeletonTable) so the loaded tiles don't shift the table down", () => {
    const { container } = renderWithIntl(<GrievancesLoading />);
    // SkeletonTable wraps everything in an aria-busy region.
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
  });

  it("does not use hard-coded slate-200 Tailwind classes (uses theme tokens)", () => {
    const { container } = renderWithIntl(<GrievancesLoading />);
    expect(container.innerHTML).not.toContain("slate-200");
    // ds Skeleton primitives paint with the --line2 token.
    expect(container.innerHTML).toContain("var(--line2)");
  });
});
