import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as hr/departments/new/page.test.tsx: control the
// session role directly at the roleGuard module boundary rather than
// re-deriving it from a fake JWT cookie (that's roleGuard.test.ts's own
// concern).
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DisciplinaryPage from "./page";

// GAP-HR-DISCIPLINARY-04: the backend response now carries pagination/stat
// metadata alongside the row array (services/hrms-service/.../gap-features/
// routes.ts's GET /v1/hrms/disciplinary-cases). mockResolvedValue below
// stands in for fetchJson's own already-mapped LoaderResult (this mock
// replaces fetchJson entirely, so its mapResponse callback never runs) --
// shape must match what page.tsx's getData() now produces: { data: {items,
// total, hasMore, stats}, source }.
function apiResult(items: Record<string, unknown>[], stats: { major: number; minor: number; open: number }) {
  return {
    data: { items, total: items.length, hasMore: false, stats },
    source: "api" as const,
  };
}

describe("DisciplinaryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("links each case row to its detail page using the real case number, not a fabricated reference", async () => {
    // Regression test (updated for GAP-HR-DISCIPLINARY-02): this table used
    // to have no rowLinkKey/rowLinkPrefix at all (unreachable detail page),
    // and separately fabricated "VIG/"+id.slice(0,8) as a case reference
    // instead of using the real, stored case_no the backend now returns.
    fetchJsonMock.mockResolvedValue(apiResult(
      [{
        id: "case-1",
        caseNo: "DC/2026/0042",
        employee: "R. Sharma",
        department: "Revenue",
        proceeding_type: "major",
        charges_summary: "Misconduct",
        filed_date: "2026-01-01",
        inquiry_officer: "—",
        status: "open",
      }],
      { major: 1, minor: 0, open: 1 },
    ));

    const ui = await DisciplinaryPage({});
    render(ui);

    const link = screen.getByRole("link", { name: "Open DC/2026/0042" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1");
  });

  it("falls back to a dash, never the raw UUID, when a row has no case_no", async () => {
    fetchJsonMock.mockResolvedValue(apiResult(
      [{
        id: "case-2", caseNo: null, employee: "A. Kumar", department: "Revenue",
        proceeding_type: "minor", charges_summary: "x", filed_date: "2026-01-01",
        inquiry_officer: "—", status: "opened",
      }],
      { major: 0, minor: 1, open: 1 },
    ));

    const ui = await DisciplinaryPage({});
    render(ui);
    const link = screen.getByRole("link", { name: "Open —" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-2");
  });

  it("shows an honest permission-denied state for a role the backend would reject, instead of a table the backend would refuse to serve", async () => {
    // Regression: GET /v1/hrms/disciplinary-cases requires hr_admin /
    // hr_officer / super_admin (gap-features/routes.ts's HR_ROLES) --
    // "employee" is admitted into /hr by layout.tsx but was never checked
    // here, so this page used to render the full case table shell (with a
    // failed/empty fetch) instead of an honest access-restricted message.
    mockRoles = ["employee"];
    const ui = await DisciplinaryPage({});
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the major/minor/open stat cards exactly as the backend computed them", async () => {
    // GAP-HR-DISCIPLINARY-04: stats (previously derived client-side from
    // `items.filter(...)`, which silently miscounted "dropped" cases as
    // open and understated everything past a 200-row page) now come
    // straight from the backend's own unconditional, tenant-wide COUNT(*)
    // aggregate -- covered end-to-end for the dropped/open exclusion logic
    // itself by disciplinary-vigilance-pagination-real-db.test.ts. This
    // test only proves the page *wires up* whatever the backend sends,
    // using stats that deliberately disagree with a naive recount of the
    // (deliberately short) `items` array, so a regression back to
    // client-side computation would be caught here too.
    fetchJsonMock.mockResolvedValue(apiResult(
      [{
        id: "case-1", caseNo: "DC/1", employee: "A. Kumar", department: "Revenue",
        proceeding_type: "minor", charges_summary: "x", filed_date: "2026-01-01",
        inquiry_officer: "—", status: "dropped",
      }],
      { major: 12, minor: 8, open: 5 },
    ));

    const ui = await DisciplinaryPage({});
    render(ui);

    const openCard = screen.getByText("Active / Open").closest(".stat");
    expect(openCard!.querySelector(".val")?.textContent).toBe("5");
    const majorCard = screen.getByText("Major (Vigilance)").closest(".stat");
    expect(majorCard!.querySelector(".val")?.textContent).toBe("12");
  });
});
