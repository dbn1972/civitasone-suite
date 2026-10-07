import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import ReportDetailPage from "./page";

function baseJob(over: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    reportName: "Expenditure summary",
    module: "finance",
    requestedBy: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-04-01T00:00:00.000Z",
    format: "pdf",
    status: "completed",
    columns: [],
    rows: [],
    totalCount: 0,
    ...over,
  };
}

describe("ReportDetailPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-REPORTS-DETAIL-01
  it("500 fetch error -> retry state, NOT 'the ID is incorrect'", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/the ID is incorrect/i)).not.toBeInTheDocument();
  });

  it("404 -> not-found copy, not the retry state", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByText(/the ID is incorrect/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  // GAP-REPORTS-DETAIL-05
  it("failed job -> 'Report failed' with a Queue again link, never 'once the report completes'", async () => {
    fetchJsonMock.mockResolvedValue({ data: baseJob({ status: "failed" }), source: "api", status: 200 });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByText("Report failed")).toBeInTheDocument();
    expect(screen.queryByText(/once the report completes/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /queue again/i })).toHaveAttribute("href", "/reports/list/new?reportType=finance");
  });

  // GAP-REPORTS-DETAIL-04
  it("formats parameter labels and ISO dates", async () => {
    fetchJsonMock.mockResolvedValue({
      data: baseJob({ status: "queued", parameters: { fromDate: "2026-04-01", departmentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } }),
      source: "api",
      status: 200,
    });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByText("From date")).toBeInTheDocument();
    expect(screen.getAllByText("01 Apr 2026").length).toBeGreaterThanOrEqual(1);
    // departmentId UUID is not shown raw
    expect(screen.queryByText("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).not.toBeInTheDocument();
    expect(screen.getByText(/Department \(ID …/)).toBeInTheDocument();
  });

  // GAP-REPORTS-DETAIL-03
  it("notes truncation + download link when totalCount exceeds shown rows", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ col_a: String(i) }));
    fetchJsonMock.mockResolvedValue({
      data: baseJob({ columns: ["col_a"], rows, totalCount: 500, downloadUrl: "https://s3/x" }),
      source: "api",
      status: 200,
    });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByText(/Showing the first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download the full report/i })).toBeInTheDocument();
  });

  // GAP-REPORTS-DETAIL-02
  it("masks sensitive columns and formats money_paise columns", async () => {
    fetchJsonMock.mockResolvedValue({
      data: baseJob({
        columns: ["pan", "amount"],
        rows: [{ pan: "ABCDE1234F", amount: "123456" }],
        totalCount: 1,
      }),
      source: "api",
      status: 200,
    });
    render(await ReportDetailPage({ params: { id: "job-1" } }));
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
    expect(screen.queryByText("ABCDE1234F")).not.toBeInTheDocument();
    expect(screen.getByText("₹1,234.56")).toBeInTheDocument();
  });
});
