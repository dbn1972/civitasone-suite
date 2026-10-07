import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-TENANT-STEWARDSHIP-05 (OTHER/UX-TABLE): pin that the stewardship list
// page renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits a search box, sortable headers, a pager and a StatusPill Status
// column (classification). Previously PARTIAL (shared-table swap deferred); the
// migration has landed on main. Fails on the old bare-<table> code.
const stewardship = vi.fn();
vi.mock("../_data", () => ({ getTenantStewardship: () => stewardship() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `dom-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zoning records" : `Domain ${i + 1}`,
  sublabel: `desc ${i + 1}`,
  status: i === 0 ? "Confidential" : "Internal",
  meta: "Unassigned",
}));

beforeEach(() => {
  stewardship.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Tenant stewardship page (GAP-TENANT-STEWARDSHIP-05)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Confidential")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zoning records" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zoning records")).toBeInTheDocument();
    expect(within(body).queryByText("Domain 2")).not.toBeInTheDocument();
  });
});
