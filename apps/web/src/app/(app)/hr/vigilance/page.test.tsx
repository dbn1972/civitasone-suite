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
  stats: { chargeMemoStage: number; underInquiry: number; penaltyAndAppeal?: number; closed: number; dropped?: number; total: number },
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

  it("renders every stat-card bucket exactly as the backend computed it (GAP-HR-VIGILANCE-02)", async () => {
    // Stats deliberately disagree with a naive recount of the (short)
    // `items` array so a regression to client-side computation is caught.
    // penaltyAndAppeal is its own card: a penalty_imposed/appeal_filed case
    // must NOT show up under "Under Inquiry".
    fetchJsonMock.mockResolvedValue(apiResult(
      [rowFor("penalty_imposed", 1)],
      { chargeMemoStage: 4, underInquiry: 3, penaltyAndAppeal: 5, closed: 2, dropped: 1, total: 15 },
    ));

    const ui = await VigilancePage({});
    render(ui);

    const val = (label: string) => screen.getByText(label).closest(".stat")!.querySelector(".val")?.textContent;
    expect(val("Charge Memo Stage")).toBe("4");
    expect(val("Under Inquiry")).toBe("3");
    expect(val("Penalty & Appeal")).toBe("5");
    expect(val("Closed")).toBe("2");
    expect(val("Dropped")).toBe("1");
    expect(val("Total Cases")).toBe("15");
    expect(["Charge Memo Stage", "Under Inquiry", "Penalty & Appeal", "Closed", "Dropped"].reduce((n, l) => n + Number(val(l)), 0)).toBe(15);
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
