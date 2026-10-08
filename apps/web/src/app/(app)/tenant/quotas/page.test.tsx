import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-TENANT-QUOTAS-06 (UX-TABLE): pin that the quotas list page renders
// through ModuleListPage -> ModuleListTable -> DS DataTable and so inherits a
// search box, sortable headers, a pager and a StatusPill Status column.
// Previously PARTIAL (shared-table swap deferred); the migration has landed on
// main. Fails on the old bare-<table> code.
const quotas = vi.fn();
vi.mock("../_data", () => ({ getTenantQuotas: () => quotas() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `quota-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zebra storage" : `Quota ${i + 1}`,
  sublabel: `${i} / 100`,
  status: i === 0 ? "Exceeded" : "OK",
  meta: `${i}%`,
}));

beforeEach(() => {
  quotas.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Tenant quotas page (GAP-TENANT-QUOTAS-06)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Exceeded")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zebra storage" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zebra storage")).toBeInTheDocument();
    expect(within(body).queryByText("Quota 2")).not.toBeInTheDocument();
  });
});
