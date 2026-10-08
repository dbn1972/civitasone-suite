import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-TENANT-POSITIONS-05 (UX-TABLE): pin that the positions list page renders
// through ModuleListPage -> ModuleListTable -> DS DataTable and so inherits a
// search box, sortable headers, a pager and a StatusPill Status column.
// Previously PARTIAL (shared-table swap deferred); the migration has landed on
// main. Fails on the old bare-<table> code (no searchbox/pager/sortable th).
const positions = vi.fn();
vi.mock("../_data", () => ({ getTenantPositions: () => positions() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `pos-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Ward Officer" : `Position ${i + 1}`,
  sublabel: `P${i + 1}`,
  status: i === 0 ? "Vacant" : "Filled",
  meta: `${i} / 2 filled`,
}));

beforeEach(() => {
  positions.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Tenant positions page (GAP-TENANT-POSITIONS-05)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Vacant")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ward Officer" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Ward Officer")).toBeInTheDocument();
    expect(within(body).queryByText("Position 2")).not.toBeInTheDocument();
  });
});
