import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import QuartersPage from "./page";

const QUARTER = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  quarterNo: "B-14",
  quarterType: "type_iv",
  category: "general",
  address: "Sector 12",
  locality: "Sector 12",
  carpetAreaSqft: 850,
  status: "vacant",
  condition: "good",
  orgUnit: null,
  version: 1,
};

function mockByKey(map: Record<string, { data: unknown; source: "api" | "error" }>) {
  fetchJsonMock.mockImplementation((_path: string, _empty: unknown, opts: { telemetryKey: string }) => {
    const hit = map[opts.telemetryKey];
    return Promise.resolve(hit ?? { data: _empty, source: "api" });
  });
}

describe("QuartersPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the quarters list with summary-driven tiles", async () => {
    mockByKey({
      "estab.quarters.list": { data: [QUARTER], source: "api" },
      "estab.quarters.summary": { data: { total: 1, byStatus: { vacant: 1 } }, source: "api" },
    });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText("B-14")).toBeInTheDocument();
    // Total tile shows the summary total
    expect(screen.getByText("Total Quarters")).toBeInTheDocument();
  });

  it("renders an empty state when there are no quarters", async () => {
    mockByKey({
      "estab.quarters.list": { data: [], source: "api" },
      "estab.quarters.summary": { data: { total: 0, byStatus: {} }, source: "api" },
    });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText("No quarters yet")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-02: single error block with Retry and four '—' tiles.
  it("shows RefreshErrorState instead of multiple DataSourceBadges on error, never fabricates stat counts", async () => {
    mockByKey({
      "estab.quarters.list": { data: [], source: "error" },
      "estab.quarters.summary": { data: null, source: "error" },
    });
    const ui = await QuartersPage();
    render(ui);

    // A retry button exists (RefreshErrorState renders "Try again")
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No quarters yet")).not.toBeInTheDocument();
    // StatCards show "—" (unknown), never a fabricated "0" count
    expect(screen.getAllByText("—").length).toBe(4);
  });

  // GAP-ESTAB-QUARTERS-01: Other tile surfaces statuses outside the three named tiles.
  it("shows an Other tile when statuses exist beyond vacant/allotted/occupied", async () => {
    const underRepair = { ...QUARTER, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", status: "under_repair" };
    mockByKey({
      "estab.quarters.list": { data: [QUARTER, underRepair], source: "api" },
      "estab.quarters.summary": { data: { total: 2, byStatus: { vacant: 1, under_repair: 1 } }, source: "api" },
    });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText("Other")).toBeInTheDocument();
    // Total = 2, Vacant = 1, Other = 1
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-01: truncation notice when total > rows
  it("shows a truncation notice when the returned list is smaller than the total", async () => {
    mockByKey({
      "estab.quarters.list": { data: [QUARTER], source: "api" },
      "estab.quarters.summary": { data: { total: 500, byStatus: { vacant: 250, allotted: 150, occupied: 100 } }, source: "api" },
    });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText(/Showing 1 of 500/)).toBeInTheDocument();
  });
});
