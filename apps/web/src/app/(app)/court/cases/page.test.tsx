import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CourtCase, CasesPage } from "../_data/types";

vi.mock("../_data/loaders", () => ({
  getCasesPage: vi.fn(),
}));
// RefreshErrorState uses next/navigation client hooks.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/court/cases",
  useSearchParams: () => new URLSearchParams(),
}));

import CasesListPage from "./page";
import { getCasesPage } from "../_data/loaders";

const mocked = vi.mocked(getCasesPage);

function makeCase(overrides: Partial<CourtCase> = {}): CourtCase {
  return {
    id: "case-1",
    cnrNumber: "DLHC010000012026",
    caseType: "civil",
    filingNumber: "F-2026-01",
    filingDate: "2026-01-10",
    title: "State vs. Sharma",
    status: "pending",
    stage: null,
    courtId: null,
    benchId: null,
    disposalDate: null,
    targetDisposalDate: "2026-06-10",
    version: 1,
    ...overrides,
  };
}

function pageResult(data: Partial<CasesPage>, source: "api" | "error" = "api") {
  return { data: { cases: [], total: 0, limit: 25, offset: 0, ...data }, source } as never;
}

describe("CasesListPage", () => {
  beforeEach(() => mocked.mockReset());

  it("shows the TRUE total (not the capped page length) and a Showing X–Y of N line (CASES-01)", async () => {
    mocked.mockResolvedValue(pageResult({ cases: [makeCase()], total: 250, limit: 25, offset: 0 }));
    render(await CasesListPage({ searchParams: {} }));
    expect(screen.getByText("All cases (250)")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–1 of 250/)).toBeInTheDocument();
    // Next is available (more than one page), Previous is not on page 1.
    expect(screen.getByRole("link", { name: /Next/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument();
  });

  it("passes status + offset through to the loader for page 2 (CASES-01)", async () => {
    mocked.mockResolvedValue(pageResult({ cases: [makeCase()], total: 60, limit: 25, offset: 25 }));
    await CasesListPage({ searchParams: { page: "2", status: "pending" } });
    expect(mocked).toHaveBeenCalledWith({ status: "pending", q: undefined, limit: 25, offset: 25 });
  });

  it("flags an overdue, still-live case but not a disposed one (CASES-02)", async () => {
    mocked.mockResolvedValue(
      pageResult({
        cases: [
          makeCase({ id: "a", title: "Overdue matter", targetDisposalDate: "2000-01-01", status: "pending" }),
          makeCase({ id: "b", title: "Closed matter", targetDisposalDate: "2000-01-01", status: "disposed" }),
        ],
        total: 2,
      }),
    );
    render(await CasesListPage({ searchParams: {} }));
    const overdueRow = screen.getByText("Overdue matter").closest("tr") as HTMLElement;
    expect(within(overdueRow).getByText("Overdue")).toBeInTheDocument();
    const closedRow = screen.getByText("Closed matter").closest("tr") as HTMLElement;
    expect(within(closedRow).queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("renders a retry error state and '—' count on loader error, not '(0)' (CASES-03)", async () => {
    mocked.mockResolvedValue(pageResult({}, "error"));
    render(await CasesListPage({ searchParams: {} }));
    expect(screen.getByText("All cases (—)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(screen.queryByText("All cases (0)")).not.toBeInTheDocument();
  });

  it("gives the actions column header an accessible name (CASES-04)", async () => {
    mocked.mockResolvedValue(pageResult({ cases: [makeCase()], total: 1 }));
    render(await CasesListPage({ searchParams: {} }));
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  it("still shows a genuine empty state for a real zero total", async () => {
    mocked.mockResolvedValue(pageResult({ cases: [], total: 0 }));
    render(await CasesListPage({ searchParams: {} }));
    expect(screen.getByText("No cases yet")).toBeInTheDocument();
  });

  it("keeps an untitled matter identifiable by CNR and filing number (CASES-05)", async () => {
    mocked.mockResolvedValue(
      pageResult({
        cases: [makeCase({ title: null, cnrNumber: "DLHC019999992026", filingNumber: "F-2026-99" })],
        total: 1,
      }),
    );
    render(await CasesListPage({ searchParams: {} }));
    const row = screen.getByText("Untitled matter").closest("tr") as HTMLElement;
    expect(within(row).getByText("DLHC019999992026")).toBeInTheDocument();
    expect(within(row).getByText("Filing F-2026-99")).toBeInTheDocument();
  });
});
