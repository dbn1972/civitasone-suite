import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-TENANT-SETTINGS-05 (OTHER/UX-TABLE): pin that the settings list page
// renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits a search box, sortable headers and a pager. Settings rows carry no
// status (mapSettingRows emits key/value only), so the Status column renders
// the shared "—" placeholder rather than a StatusPill. Previously PARTIAL
// (shared-table swap deferred); the migration has landed on main. Fails on the
// old bare-<table> code (no searchbox/pager/sortable th).
const settings = vi.fn();
vi.mock("../_data", () => ({ getTenantSettings: () => settings() }));

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `set-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "feature.flags" : `setting.key.${i + 1}`,
  sublabel: `desc ${i + 1}`,
  meta: `value-${i + 1}`,
}));

beforeEach(() => {
  settings.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Tenant settings page (GAP-TENANT-SETTINGS-05)", () => {
  it("inherits the DataTable search box, sortable Name header and pager", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "feature.flags" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("feature.flags")).toBeInTheDocument();
    expect(within(body).queryByText("setting.key.2")).not.toBeInTheDocument();
  });
});
