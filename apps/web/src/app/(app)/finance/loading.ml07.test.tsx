import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PfmsLoading from "./pfms/loading";
import ReconLoading from "./reconciliation/loading";
import ReconDetailLoading from "./reconciliation/[id]/loading";
import RecurringLoading from "./recurring-entries/loading";

// GAP-FINANCE-PFMS-09 / RECONCILIATION-08 / RECONCILIATION-DETAIL-06 /
// RECURRING-ENTRIES-07: loading shells mirror the page and are localised.
describe("ml-finance-07 loading skeletons", () => {
  it.each([
    ["pfms", PfmsLoading, 4, 1],
    ["reconciliation", ReconLoading, 4, 1],
    ["reconciliation detail", ReconDetailLoading, 4, 1],
    ["recurring entries", RecurringLoading, 2, 2],
  ] as const)("%s: labelled status region with %i stat placeholders and %i card(s)", async (_n, Comp, stats, cards) => {
    const ui = await Comp();
    const { container } = render(ui);
    const root = screen.getByRole("status");
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root).toHaveAttribute("aria-label", "Loading…");
    expect(container.querySelectorAll(".grid.g-4 > div")).toHaveLength(stats);
    expect(container.querySelectorAll(".card")).toHaveLength(cards);
  });
});
