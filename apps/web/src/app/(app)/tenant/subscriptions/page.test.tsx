import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-TENANT-SUBSCRIPTIONS-06 (OTHER/UX-TABLE): pin that the subscriptions list
// page renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits a search box, sortable headers, a pager and a StatusPill Status
// column. Previously PARTIAL (shared-table swap deferred); the migration has
// landed on main. Fails on the old bare-<table> code.
const subscriptions = vi.fn();
vi.mock("../_data", () => ({ getTenantSubscriptions: () => subscriptions() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `plan-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zenith plan" : `Plan ${i + 1}`,
  sublabel: "₹1,000.00",
  status: i === 0 ? "Active" : "Trialing",
  meta: "Renews 01 Jan 2027",
}));

beforeEach(() => {
  subscriptions.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Tenant subscriptions page (GAP-TENANT-SUBSCRIPTIONS-06)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zenith plan" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zenith plan")).toBeInTheDocument();
    expect(within(body).queryByText("Plan 2")).not.toBeInTheDocument();
  });
});
