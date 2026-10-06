import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import ReportsListPage from "./page";

function job(over: Record<string, unknown> = {}) {
  return {
    id: "job-1", reportName: "R1", module: "finance",
    requestedBy: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-04-01T00:00:00Z", format: "pdf", status: "completed",
    downloadUrl: "https://s3/x", ...over,
  };
}

describe("ReportsListPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-REPORTS-LIST-01
  it("on error the four stats render '—' and the retry card shows", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await ReportsListPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(4);
  });

  it("with 0 jobs (not error) stats still read 0 and empty-state shows", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api", status: 200 });
    render(await ReportsListPage());
    expect(screen.getByText("No report jobs found")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3);
  });

  // GAP-REPORTS-LIST-03
  it("renders 'Unknown user' instead of a raw requestedBy UUID", async () => {
    fetchJsonMock.mockResolvedValue({ data: [job()], source: "api", status: 200 });
    render(await ReportsListPage());
    expect(screen.getByText("Unknown user")).toBeInTheDocument();
    expect(screen.queryByText("11111111-1111-4111-8111-111111111111")).not.toBeInTheDocument();
  });
});
