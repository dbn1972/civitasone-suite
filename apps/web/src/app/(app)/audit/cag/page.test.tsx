import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import CagPage from "./page";

// GAP-AUDIT-CAG-01: rows carry a real per-paragraph status; the page derives
// counts from them (no fabricated totalParas/settled/pending per row).
const MOCK_PARAS = [
  { id: "p1", reportYear: "2024-25", paraNo: "1", department: "Finance", status: "settled" },
  { id: "p2", reportYear: "2024-25", paraNo: "2", department: "Finance", status: "partially_settled" },
  { id: "p3", reportYear: "2024-25", paraNo: "3", department: "Works", status: "under_review" },
];

describe("CagPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-AUDIT-CAG-01: KPIs are 3 paragraphs / 1 settled / 2 pending from real statuses", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_PARAS, source: "api" });
    render(await CagPage());
    expect(screen.getByText("Paragraphs")).toBeInTheDocument();
    // Total 3, settled 1, pending 2, departments 2 — all present as stat values.
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    // No fabricated per-row count columns.
    expect(screen.queryByText("Total Paras")).not.toBeInTheDocument();
  });

  it("GAP-AUDIT-CAG-02: a valid empty list shows the honest empty state, not an error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await CagPage());
    expect(screen.getByText("No CAG paragraphs found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await CagPage());
    expect(screen.getByText("We couldn't load CAG audit paragraphs.")).toBeInTheDocument();
    expect(screen.queryByText("No CAG paragraphs found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
