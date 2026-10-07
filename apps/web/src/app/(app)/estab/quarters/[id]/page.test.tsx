import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/api/browserClient", () => ({
  browserJson: vi.fn(),
}));

import QuarterDetailPage from "./page";

const QUARTER = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  quarterNo: "B-14",
  quarterType: "type_iv",
  category: "general",
  address: "Sector 12",
  locality: "Sector 12",
  carpetAreaSqft: 1250,
  status: "occupied",
  condition: "needs_repair",
  orgUnit: null,
  version: 1,
};

const ALLOTMENT = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  quarterId: QUARTER.id,
  employeeRef: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  employeeName: null,
  quarterNo: "B-14",
  designation: "Section Officer",
  payLevel: "7",
  status: "occupied",
  appliedAt: "2026-07-01T00:00:00.000Z",
};

function mockFetchJsonByKey(map: Record<string, { data: unknown; source: "api" | "error" }>) {
  fetchJsonMock.mockImplementation((_path: string, _empty: unknown, opts: { telemetryKey: string }) => {
    const hit = map[opts.telemetryKey];
    return Promise.resolve(hit ?? { data: _empty, source: "api" });
  });
}

describe("QuarterDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // GAP-ESTAB-QUARTERS-DETAIL-03: quarter fetch 500 renders a Retry button
  it("renders RefreshErrorState with Retry when the quarter fetch errors", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: null, source: "error" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("could not be found")).not.toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-DETAIL-03: quarter fetch 404 renders not-found
  it("calls notFound when the quarter is not found (api returned null)", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: null, source: "api" },
    });
    await expect(QuarterDetailPage({ params: { id: QUARTER.id } })).rejects.toThrow("NOT_FOUND");
  });

  // GAP-ESTAB-QUARTERS-DETAIL-04: no Version label, Condition humanised, carpet area formatted
  it("does not show Version and humanises Condition (DETAIL-04)", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [], total: 0 }, source: "api" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.queryByText("Version")).not.toBeInTheDocument();
    expect(screen.getByText("Needs repair")).toBeInTheDocument();
    // GAP-ESTAB-QUARTERS-DETAIL-05: carpet area formatted with grouping
    expect(screen.getByText("1,250 sq. ft.")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-DETAIL-05: non-vacant quarter shows explanation note
  it("shows an explanatory note instead of the form for a non-vacant quarter", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [], total: 0 }, source: "api" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.getByRole("note")).toHaveTextContent(/Applications are only accepted for vacant quarters/);
    // The note contains the formatted status "Occupied"
    expect(screen.getByRole("note")).toHaveTextContent("Occupied");
  });

  // GAP-ESTAB-QUARTERS-DETAIL-05: vacant quarter shows the form
  it("shows the apply form for a vacant quarter", async () => {
    const vacantQuarter = { ...QUARTER, status: "vacant" };
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: vacantQuarter, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [], total: 0 }, source: "api" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    // Button text within the form
    expect(screen.getByRole("button", { name: "Apply for allotment" })).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-DETAIL-01: allotment history uses quarterId filter
  it("shows allotment history for the quarter, employee name when resolved", async () => {
    const withName = { ...ALLOTMENT, employeeName: "Kiran Bose" };
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [withName], total: 1 }, source: "api" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.getByText("Kiran Bose")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-DETAIL-01: truncation notice
  it("shows truncation notice when total > returned rows", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [ALLOTMENT], total: 120 }, source: "api" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.getByText(/Showing 1 of 120/)).toBeInTheDocument();
  });

  // Allotment list error: RefreshErrorState with Retry
  it("shows RefreshErrorState when allotments error and list is empty", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: { rows: [], total: 0 }, source: "error" },
    });
    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
