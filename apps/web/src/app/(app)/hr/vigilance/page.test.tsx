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

// The full real status enum (disciplinary/state-machine.ts's CaseStatus) --
// a vigilance case is a proceeding_type='major' disciplinary case, so it
// shares this exact enum (see gap-features/routes.ts's GET /v1/hrms/vigilance).
const ALL_STATUSES = [
  "opened", "charge_memo_issued", "inquiry_appointed", "finding_recorded",
  "pending_approval", "penalty_imposed", "appeal_filed", "appeal_decided",
  "closed", "dropped",
];

function rowFor(status: string, i: number) {
  return {
    id: `case-${i}`,
    employee: `Employee ${i}`,
    department: "Revenue",
    charges: "Misconduct",
    filedDate: "2026-01-01",
    inquiryOfficer: "—",
    nextHearing: "—",
    status,
  };
}

describe("VigilancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("links each case row to the shared disciplinary detail page instead of leaving it unreachable", async () => {
    // Regression: this table had no rowLinkKey/rowLinkPrefix at all, so a
    // vigilance case (which IS a disciplinary case, proceeding_type='major')
    // had no way to reach its own already-built detail page from here.
    fetchJsonMock.mockResolvedValue({ data: [rowFor("opened", 1)], source: "api" });

    const ui = await VigilancePage();
    render(ui);

    const link = screen.getByRole("link", { name: "Open VIG/CASE-1" });
    expect(link).toHaveAttribute("href", "/hr/disciplinary/case-1");
  });

  it("covers all 10 real case statuses across the three stat-card buckets, with none left out", async () => {
    // Regression: only "opened" and a nonexistent "inquiry"/"under_inquiry"
    // status were ever matched (plus "closed"; "disposed"/"finalised" are
    // not real statuses for this table either), so "Under Inquiry" could
    // never show a nonzero count and most of the 10 real statuses silently
    // vanished from every stat card.
    fetchJsonMock.mockResolvedValue({
      data: ALL_STATUSES.map((s, i) => rowFor(s, i)),
      source: "api",
    });

    const ui = await VigilancePage();
    render(ui);

    const total = screen.getByText("Total Cases").closest(".stat");
    const chargeMemoStage = screen.getByText("Charge Memo Stage").closest(".stat");
    const underInquiry = screen.getByText("Under Inquiry").closest(".stat");
    const disposedClosed = screen.getByText("Disposed / Closed").closest(".stat");

    // opened + charge_memo_issued
    expect(chargeMemoStage!.querySelector(".val")?.textContent).toBe("2");
    // inquiry_appointed + finding_recorded + pending_approval +
    // penalty_imposed + appeal_filed + appeal_decided
    expect(underInquiry!.querySelector(".val")?.textContent).toBe("6");
    // closed + dropped
    expect(disposedClosed!.querySelector(".val")?.textContent).toBe("2");
    expect(total!.querySelector(".val")?.textContent).toBe("10");
  });

  it("shows an honest permission-denied state for a role the backend would reject", async () => {
    mockRoles = ["employee"];
    const ui = await VigilancePage();
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
