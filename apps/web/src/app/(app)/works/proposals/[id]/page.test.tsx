import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-WORKS-PROPOSALS-DETAIL-01 (FAILMASK): a non-404 failure must render a
 * retryable error state, not the 404 "not found" page.
 * GAP-WORKS-PROPOSALS-DETAIL-02 (WIRING): the timeline shows only the two
 * backend-driven states (Created, DAO Finalized) — never the dead Submitted/
 * TS Eligible/AA Issued steps.
 * GAP-WORKS-PROPOSALS-DETAIL-06: Charged/Voted, Habitation and Sector appear.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["works_admin"] }));

// Client-component children are not under test here.
vi.mock("./ProposalActions", () => ({ ProposalActions: () => null }));
vi.mock("./ProposalExtActions", () => ({ ProposalExtActions: () => null }));
vi.mock("./ProposalEditToggle", () => ({ ProposalEditToggle: () => null }));

import WorkProposalDetailPage from "./page";

const PROPOSAL = {
  id: "p1",
  workNumber: "WRK/2026/001",
  category: "regular",
  description: "Village road repair",
  estimatedCostMinor: "5000000",
  status: "draft",
  district: "Khordha",
  taluka: "Bhubaneswar",
  village: "Patia",
  habitation: "Ward 12",
  sector: "rural_roads",
  remarks: "",
  daoFinalizedAt: null,
  createdAt: "2026-04-01",
  updatedAt: "2026-04-02",
  workTypeId: null,
  chargedOrVoted: "voted",
  planOrNonPlan: "plan",
  budgetYear: "2026-27",
};

describe("WorkProposalDetailPage", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    fetchJsonMock.mockReset();
  });

  it("renders RefreshErrorState (not notFound) on a 500 (DETAIL-01)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await WorkProposalDetailPage({ params: { id: "p1" } });
    render(ui);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't load work proposal/i)).toBeInTheDocument();
  });

  it("calls notFound() on a real 404 (DETAIL-01)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(WorkProposalDetailPage({ params: { id: "p1" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("shows only Created and DAO Finalized timeline steps — no dead steps (DETAIL-02)", async () => {
    fetchJsonMock.mockResolvedValue({ data: PROPOSAL, source: "api", status: 200 });
    const ui = await WorkProposalDetailPage({ params: { id: "p1" } });
    render(ui);
    expect(screen.getByText("Proposal Created")).toBeInTheDocument();
    expect(screen.getByText("DAO Finalized")).toBeInTheDocument();
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("TS Eligible")).not.toBeInTheDocument();
    expect(screen.queryByText("AA Issued")).not.toBeInTheDocument();
  });

  it("renders Charged/Voted, Habitation and Sector detail rows (DETAIL-06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: PROPOSAL, source: "api", status: 200 });
    const ui = await WorkProposalDetailPage({ params: { id: "p1" } });
    render(ui);
    expect(screen.getByText("Charged / Voted")).toBeInTheDocument();
    expect(screen.getByText("Habitation")).toBeInTheDocument();
    expect(screen.getByText("Sector")).toBeInTheDocument();
    expect(screen.getByText("Ward 12")).toBeInTheDocument();
    expect(screen.getByText("Rural Roads")).toBeInTheDocument(); // humanized
  });
});
