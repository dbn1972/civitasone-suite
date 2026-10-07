import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-THEMES-BRANDING-06 (OTHER/UX-TABLE): pin that the branding list page
// renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits a search box, sortable headers, a pager and a StatusPill Status
// column. Previously PARTIAL (full DataTable swap deferred); landed on main.
// Fails on the old bare-<table> code.
const branding = vi.fn();
vi.mock("../_data", () => ({ getThemeBranding: () => branding() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `pack-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zenith pack" : `Pack ${i + 1}`,
  sublabel: `desc ${i + 1}`,
  status: i === 0 ? "active" : "draft",
  meta: `C${i + 1}`,
}));

beforeEach(() => {
  branding.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Themes branding page (GAP-THEMES-BRANDING-06)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zenith pack" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zenith pack")).toBeInTheDocument();
    expect(within(body).queryByText("Pack 2")).not.toBeInTheDocument();
  });
});
