import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary rather than
// re-deriving it from a fake JWT cookie.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import VigilancePage from "./page";

function rowFor(status: string, i: number) {
  return {
    id: `case-${i}`,
    caseNo: `VC/${i}`,
    employee: `Employee ${i}`,
    department: "Revenue",
    charges_summary: "Misconduct",
    filedDate: "2026-01-01",
    inquiryOfficer: "—",
    nextHearing: "—",
    inquiryAppointedDate: "—",
    status,
  };
}

// GAP-HR-VIGILANCE-04: the backend response now carries pagination/stat
// metadata (services/hrms-service/.../gap-features/routes.ts's GET
// /v1/hrms/vigilance) alongside the row array. This mock replaces fetchJson
// entirely (its mapResponse callback never runs), so the shape here must
// match what page.tsx's getData() now produces: { data: {items, total,
// hasMore, stats}, source }.
function apiResult(
  items: Record<string, unknown>[],
  stats: { chargeMemoStage: number; underInquiry: number; closed: number; total: number },
) {
  return {
    data: { items, total: items.length, hasMore: false, stats },
    source: "api" as const,
  };
}

describe("VigilancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("links each case row to the shared disciplinary detail page using the real case number, not a fabricated reference", async () => {
    // Regression: this table used to have no rowLinkKey/rowLinkPrefix at
    // all (a vigilance case IS a disciplinary case, proceeding_type='major',
    // and had no way to reach its own already-built detail page from here),
    // and separately fabricated "VIG/"+id.slice(0,8) instead of using the
    // real, stored case_no the backend now returns (GAP-HR-VIGILANCE-06).
    fetchJsonMock.mockResolvedValue(apiResult(
      [rowFor("opened", 1)],
      { chargeMemoStage: 1, underInquiry: 0, closed: 0, total: 1 },
    ));

    const ui = await VigilancePage({});
    render(ui);

    const link = screen.getByRole("link", { name: "Open VC/1" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1");
  });

  it("renders all three stat-card buckets exactly as the backend computed them", async () => {
    // Regression (updated for GAP-HR-VIGILANCE-02/04): the three buckets
    // (charge-memo stage / under inquiry / disposed-closed, mutually
    // exclusive and exhaustive over all 10 real CaseStatus values) are now
    // computed server-side, not from `items.filter(...)` -- covered
    // end-to-end for the bucket logic itself by
    // disciplinary-vigilance-pagination-real-db.test.ts. This test only
    // proves the page *wires up* whatever the backend sends, using stats
    // that deliberately disagree with a naive recount of the (deliberately
    // short) `items` array, so a regression back to client-side computation
    // would be caught here too.
    fetchJsonMock.mockResolvedValue(apiResult(
      [rowFor("opened", 1)],
      { chargeMemoStage: 4, underInquiry: 3, closed: 2, total: 9 },
    ));

    const ui = await VigilancePage({});
    render(ui);

    const total = screen.getByText("Total Cases").closest(".stat");
    const chargeMemoStage = screen.getByText("Charge Memo Stage").closest(".stat");
    const underInquiry = screen.getByText("Under Inquiry").closest(".stat");
    const disposedClosed = screen.getByText("Disposed / Closed").closest(".stat");

    expect(chargeMemoStage!.querySelector(".val")?.textContent).toBe("4");
    expect(underInquiry!.querySelector(".val")?.textContent).toBe("3");
    expect(disposedClosed!.querySelector(".val")?.textContent).toBe("2");
    expect(total!.querySelector(".val")?.textContent).toBe("9");
  });

  it("shows a link back to the full disciplinary register (GAP-HR-VIGILANCE-05)", async () => {
    fetchJsonMock.mockResolvedValue(apiResult(
      [],
      { chargeMemoStage: 0, underInquiry: 0, closed: 0, total: 0 },
    ));
    const ui = await VigilancePage({});
    render(ui);
    const link = screen.getByRole("link", { name: "All Disciplinary Cases" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary");
  });

  it("shows an honest permission-denied state for a role the backend would reject", async () => {
    mockRoles = ["employee"];
    const ui = await VigilancePage({});
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
