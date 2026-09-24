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

describe("DisciplinaryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("links each case row to its detail page instead of leaving it unreachable", async () => {
    // Regression test: this table had no rowLinkKey/rowLinkPrefix at all, so
    // the fully-built disciplinary/[id] detail page was unreachable from
    // anywhere in the app except by hand-typing a case UUID into the URL.
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "case-1",
          employee: "R. Sharma",
          department: "Revenue",
          proceeding_type: "major",
          charges: "Misconduct",
          filed_date: "2026-01-01",
          inquiry_officer: "—",
          status: "open",
        },
      ],
      source: "api",
    });

    const ui = await DisciplinaryPage();
    render(ui);

    // The DataTable links its first column (Case Ref, derived as
    // "VIG/"+id for a major case) to the row's detail page.
    const link = screen.getByRole("link", { name: "Open VIG/CASE-1" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1");
  });

  it("shows an honest permission-denied state for a role the backend would reject, instead of a table the backend would refuse to serve", async () => {
    // Regression: GET /v1/hrms/disciplinary-cases requires hr_admin /
    // hr_officer / super_admin (gap-features/routes.ts's HR_ROLES) --
    // "employee" is admitted into /hr by layout.tsx but was never checked
    // here, so this page used to render the full case table shell (with a
    // failed/empty fetch) instead of an honest access-restricted message.
    mockRoles = ["employee"];
    const ui = await DisciplinaryPage();
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("does not count a dropped (investigated-and-exonerated) case as open", async () => {
    // Regression: the "open" stat excluded only "closed"/"disposed"/
    // "finalised" -- of those, only "closed" is a real status for this table
    // (disciplinary/state-machine.ts's CaseStatus), so a "dropped" case
    // (investigated and discontinued/exonerated) was never excluded and
    // stayed counted as open forever.
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "case-1", employee: "A. Kumar", department: "Revenue", proceeding_type: "minor", charges: "x", filed_date: "2026-01-01", inquiry_officer: "—", status: "opened" },
        { id: "case-2", employee: "B. Rao", department: "Revenue", proceeding_type: "minor", charges: "y", filed_date: "2026-01-01", inquiry_officer: "—", status: "closed" },
        { id: "case-3", employee: "C. Singh", department: "Revenue", proceeding_type: "major", charges: "z", filed_date: "2026-01-01", inquiry_officer: "—", status: "dropped" },
      ],
      source: "api",
    });

    const ui = await DisciplinaryPage();
    render(ui);

    const openCard = screen.getByText("Active / Open").closest(".stat");
    expect(openCard).not.toBeNull();
    expect(openCard!.querySelector(".val")?.textContent).toBe("1");
  });
});
