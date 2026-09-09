import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { RevisedEstimatesTable, type RevisedEstimateRow } from "./RevisedEstimatesTable";

const mockedHook = vi.mocked(useSeededResource);

const sampleEstimates: RevisedEstimateRow[] = [
  {
    id: "be-1",
    headCode: "2202",
    description: "General Education",
    budgetEstimate: 100000,
    revisedEstimate: 120000,
    variancePct: 20,
    status: "increased",
  },
];

describe("RevisedEstimatesTable — UX-002 (single source of truth for data provenance)", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: sampleEstimates as never,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("shows nothing extra when data is live", () => {
    render(<RevisedEstimatesTable estimates={sampleEstimates} source="api" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Named repro site (RevisedEstimatesTable.tsx:22-26 per the gap report): the
  // page rendered its own badge from the raw server `source` while this table
  // separately derived `fromCache` — a failed fetch with a usable cache used
  // to show both "showing nothing" and "Showing saved data" simultaneously.
  it("shows ONE consistent message when the fetch failed but cached estimates exist", () => {
    mockedHook.mockReturnValue({
      data: sampleEstimates as never,
      fromCache: true,
      offline: true,
      cachedAt: "2026-08-30T06:00:00.000Z",
      provenance: "cached",
    } as never);
    render(<RevisedEstimatesTable estimates={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Showing saved data/i);
    expect(statusNodes[0]).toHaveTextContent(/could not refresh/i);
    expect(statusNodes[0]).toHaveTextContent(/you're offline/i);
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });

  it("shows an honest, unambiguous empty state when the fetch failed and no cache exists", () => {
    mockedHook.mockReturnValue({
      data: [] as never,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "error-no-data",
    } as never);
    render(<RevisedEstimatesTable estimates={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Couldn't load — showing nothing/i);
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    expect(screen.getByText("No estimates")).toBeInTheDocument();
  });
});
