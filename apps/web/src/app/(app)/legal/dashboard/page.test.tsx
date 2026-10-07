import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getLegalDashboard = vi.fn();
const getLegalHearings = vi.fn();

vi.mock("../../../_data/loaders", () => ({
  getLegalDashboard: () => getLegalDashboard(),
  getLegalHearings: () => getLegalHearings(),
}));
vi.mock("../../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import LegalDashboardPage from "./page";

const okDash = (over: Record<string, number> = {}) => ({
  data: { activeCases: 3, hearingsThisWeek: 2, ordersPending: 1, opinionsDue: 4, disposedCases: 30, totalCases: 120, ...over },
  source: "api" as const,
});

describe("Legal dashboard (GAP-LEGAL-DASHBOARD-01/03/04)", () => {
  beforeEach(() => {
    getLegalDashboard.mockReset();
    getLegalHearings.mockReset();
    getLegalHearings.mockResolvedValue({ data: [], source: "api" });
  });

  it("computes disposal rate from disposed/total (25%), never a hard-coded 64%", async () => {
    getLegalDashboard.mockResolvedValue(okDash());
    render(await LegalDashboardPage());
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.queryByText("64%")).not.toBeInTheDocument();
  });

  it("shows '—' (not 64%) for disposal rate when there are zero cases", async () => {
    getLegalDashboard.mockResolvedValue(okDash({ activeCases: 0, disposedCases: 0, totalCases: 0 }));
    render(await LegalDashboardPage());
    expect(screen.queryByText("64%")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("labels the opinions-due card 'Opinions Due', not 'Adverse Risk'", async () => {
    getLegalDashboard.mockResolvedValue(okDash());
    render(await LegalDashboardPage());
    expect(screen.getByText("Opinions Due")).toBeInTheDocument();
    expect(screen.queryByText("Adverse Risk")).not.toBeInTheDocument();
  });

  it("renders a retry error state (not zeros/64%) when the dashboard fetch fails", async () => {
    getLegalDashboard.mockResolvedValue({ data: { activeCases: 0, hearingsThisWeek: 0, ordersPending: 0, opinionsDue: 0, disposedCases: 0, totalCases: 0 }, source: "error" });
    render(await LegalDashboardPage());
    expect(screen.queryByText("64%")).not.toBeInTheDocument();
    expect(screen.queryByText("Disposal rate")).not.toBeInTheDocument();
  });
});

describe("Legal dashboard upcoming hearings (GAP-LEGAL-DASHBOARD-02)", () => {
  beforeEach(() => {
    getLegalDashboard.mockReset();
    getLegalHearings.mockReset();
    getLegalDashboard.mockResolvedValue(okDash({ hearingsThisWeek: 1 }));
  });

  it("lists hearings from getLegalHearings instead of an always-empty table", async () => {
    getLegalHearings.mockResolvedValue({
      data: [{ id: "h1", caseId: "c1", caseNo: "WP/9/2026", caseTitle: "X v Y", court: "High Court", date: "2999-01-01", purpose: "Arguments", status: "scheduled" }],
      source: "api",
    });
    render(await LegalDashboardPage());
    expect(screen.getByText("WP/9/2026")).toBeInTheDocument();
  });
});
