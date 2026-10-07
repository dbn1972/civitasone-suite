import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import AnalyticsDashboardDetailPage from "./page";

const DETAIL = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Budget Overview",
  description: "Quarterly budget",
  status: "active",
  visibility: "shared",
  ownerId: "22222222-2222-2222-2222-222222222222",
  version: 3,
  widgets: [
    { id: "w1", title: "Spend by dept", vizType: "bar", position: 1 },
    { id: "w2", title: "Top vendors", vizType: "table", position: 0 },
  ],
  shares: [{ id: "s1", dashboardId: "d", principalId: "p", access: "view" }],
};

describe("AnalyticsDashboardDetailPage (GAP-ANALYTICS-DASHBOARDS-01)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
  });

  it("renders metadata, owner, visibility, version and widgets on success", async () => {
    fetchJsonMock.mockImplementation((_path, _empty, opts: { mapResponse: (p: unknown) => unknown }) => {
      return Promise.resolve({ data: opts.mapResponse(DETAIL), source: "api" });
    });
    render(await AnalyticsDashboardDetailPage({ params: { id: DETAIL.id } }));
    expect(screen.getByText("Budget Overview")).toBeInTheDocument();
    expect(screen.getByText("Spend by dept", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    // owner id is shown shortened
    expect(screen.getByText("22222222")).toBeInTheDocument();
  });

  it("calls notFound() on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(AnalyticsDashboardDetailPage({ params: { id: "missing" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledOnce();
  });

  it("shows a retryable error state (not not-found) on a transient failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await AnalyticsDashboardDetailPage({ params: { id: DETAIL.id } }));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});
