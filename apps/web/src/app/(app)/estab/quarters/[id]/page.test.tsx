import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
  carpetAreaSqft: 850,
  status: "occupied",
  condition: "good",
  orgUnit: null,
  version: 1,
};

const ALLOTMENT = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  quarterId: QUARTER.id,
  employeeRef: "cccccccc-cccc-cccc-cccc-cccccccccccc",
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

describe("QuarterDetailPage — allotment history source masking", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("shows the data-source badge next to the card title when the allotment list errors, even with stale non-empty rows", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: [ALLOTMENT], source: "error" },
    });

    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    // Stale row still renders...
    expect(screen.getByText("Section Officer")).toBeInTheDocument();
    // ...but the error must still be visibly flagged, not silently hidden because length > 0.
    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });

  it("shows no badge when the allotment list loads cleanly", async () => {
    mockFetchJsonByKey({
      "estab.quarters.detail": { data: QUARTER, source: "api" },
      "estab.quarters.allotments.byQuarter": { data: [ALLOTMENT], source: "api" },
    });

    const ui = await QuarterDetailPage({ params: { id: QUARTER.id } });
    render(ui);

    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });
});
