import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-CATALOGUE-BUNDLES-06 (TABLE-FEATURES): pin that the bundles list page
// renders through the shared ModuleListPage -> ModuleListTable -> DS DataTable,
// so it inherits a search box, sortable headers, a pager and a StatusPill
// Status column. This was previously PARTIAL/deferred because swapping the
// hand-rolled <table> in ModuleListTable for DataTable touched ~64 shared
// consumers; that migration has since landed on main (ModuleListTable.tsx uses
// <DataTable sortable filterable pageSize={15}> + <StatusPill>). This test
// renders the REAL component chain (ModuleListPage is NOT mocked) and fails on
// the old bare-<table> code which had no searchbox/pager/sortable headers.
const bundles = vi.fn();
vi.mock("../_data", () => ({ getCatalogueBundles: () => bundles() }));

import Page from "./page";

// 16 rows so pageSize=15 forces a second page (pager must appear).
const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `bundle-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zebra combo" : `Bundle ${i + 1}`,
  sublabel: `desc ${i + 1}`,
  status: i === 0 ? "active" : "draft",
  meta: `${i + 1} members`,
}));

beforeEach(() => {
  bundles.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Catalogue bundles page (GAP-CATALOGUE-BUNDLES-06)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());

    // search box (filterable)
    const search = screen.getByRole("searchbox");
    expect(search).toBeInTheDocument();

    // sortable Name header exposes aria-sort
    const nameHeader = screen.getByText("Name", { selector: "th" });
    expect(nameHeader).toHaveAttribute("aria-sort");

    // pager appears because 16 rows > pageSize 15
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();

    // Status column renders a StatusPill (humanized label inside a .pill span)
    const pill = screen.getByText("Active");
    expect(pill).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "Zebra" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zebra combo")).toBeInTheDocument();
    expect(within(body).queryByText("Bundle 2")).not.toBeInTheDocument();
  });
});
