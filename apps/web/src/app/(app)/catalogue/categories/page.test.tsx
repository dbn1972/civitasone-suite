import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-CATALOGUE-CATEGORIES-06 (TABLE-FEATURES): pin that the categories list
// page renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits search/sort/pager/StatusPill. Previously PARTIAL/deferred for the
// 64-consumer shared-table swap, now landed on main. Fails on the old
// bare-<table> ModuleListTable (no searchbox/pager/sortable headers).
const categories = vi.fn();
vi.mock("../_data", () => ({ getCatalogueCategories: () => categories() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `cat-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zoning" : `Category ${i + 1}`,
  sublabel: `tier ${i + 1}`,
  status: i === 0 ? "active" : "draft",
  meta: `C${i + 1}`,
}));

beforeEach(() => {
  categories.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Catalogue categories page (GAP-CATALOGUE-CATEGORIES-06)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zoning" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zoning")).toBeInTheDocument();
    expect(within(body).queryByText("Category 2")).not.toBeInTheDocument();
  });
});
