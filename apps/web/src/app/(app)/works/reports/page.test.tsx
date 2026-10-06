import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-WORKS-REPORTS-02 (FAILMASK): three independent fetches must not share
 * one aggregate error badge — a failed summary next to a populated register
 * used to read as "Total Works 0". Each block now shows its own error/retry.
 * GAP-WORKS-REPORTS-06 (FORMAT): the Category column must be humanized.
 */

type LoaderResult = { data: unknown; source: "api" | "error" };
const results: Record<string, LoaderResult> = {};

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    const key = path.includes("/summary") ? "summary" : path.includes("/status") ? "status" : "works";
    const r = results[key] ?? { data: empty, source: "api" };
    if (r.source === "error") return Promise.resolve({ data: empty, source: "error" });
    return Promise.resolve({ data: opts.mapResponse(r.data) ?? empty, source: "api" });
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import WorksReportsPage from "./page";

function envelope(data: unknown) {
  return { data };
}

const WORKS = Array.from({ length: 3 }, (_, i) => ({
  id: `w${i}`,
  workNumber: `WRK/2026/00${i}`,
  description: "Road work",
  category: "regular",
  estimatedCostMinor: "5000000",
  status: "draft",
  district: "Khordha",
  createdAt: "2026-04-01",
}));

describe("WorksReportsPage", () => {
  beforeEach(() => {
    results.summary = { data: envelope({ totalWorks: 7, activeWorks: 5, closedWorks: 2 }), source: "api" };
    results.status = { data: envelope([{ status: "draft", count: 7 }]), source: "api" };
    results.works = { data: envelope(WORKS), source: "api" };
  });

  it("humanizes the Category token (REPORTS-06): 'regular' renders 'Regular'", async () => {
    const ui = await WorksReportsPage({ searchParams: {} });
    render(ui);
    expect(screen.getAllByText("Regular").length).toBeGreaterThan(0);
    expect(screen.queryByText("regular")).not.toBeInTheDocument();
  });

  it("shows a per-block retry for a failed summary while the register still renders (REPORTS-02)", async () => {
    results.summary = { data: { totalWorks: 0, activeWorks: 0, closedWorks: 0 }, source: "error" };
    const ui = await WorksReportsPage({ searchParams: {} });
    render(ui);
    // The register still shows its rows...
    expect(screen.getByText("WRK/2026/001")).toBeInTheDocument();
    // ...and the summary block shows an honest error (Try again), not "0".
    expect(screen.getByText(/couldn't load works summary/i)).toBeInTheDocument();
  });

  it("shows a per-block retry for a failed register, not an empty 'No works found'", async () => {
    results.works = { data: [], source: "error" };
    const ui = await WorksReportsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText(/couldn't load works register/i)).toBeInTheDocument();
    expect(screen.queryByText("No works match the selected filters.")).not.toBeInTheDocument();
  });

  it("shows an 'Other / In progress' residual so Active + Closed + Other = Total (REPORTS-05)", async () => {
    // total 7, active 5, closed 2 => other 0; use a gap to prove the residual.
    results.summary = { data: envelope({ totalWorks: 10, activeWorks: 5, closedWorks: 2 }), source: "api" };
    const ui = await WorksReportsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("Other / In progress")).toBeInTheDocument();
    // The residual value 10 - 5 - 2 = 3 is rendered.
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
