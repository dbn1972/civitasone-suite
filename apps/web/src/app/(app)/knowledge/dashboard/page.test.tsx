import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const mockDocs = vi.fn();
const mockSummary = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getKnowledgeDocs: (...a: unknown[]) => mockDocs(...a),
  getKnowledgeDocsSummary: (...a: unknown[]) => mockSummary(...a),
}));

// GAP2-KNOWLEDGE-DASHBOARD-CAP-01: the stat cards now read a server-side
// repository-wide aggregate. Derive that aggregate from the same fixture docs
// (tests can override total to model a repository bigger than one page).
type Doc = { status: string; category: string };
function summaryOf(docs: Doc[], total = docs.length) {
  const byStatus: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const d of docs) { byStatus[d.status] = (byStatus[d.status] ?? 0) + 1; byCat[d.category] = (byCat[d.category] ?? 0) + 1; }
  return {
    data: {
      total,
      byStatus,
      byCategory: Object.entries(byCat).map(([category, count]) => ({ category, count })),
      circulars: docs.filter((d) => /circular|polic/i.test(d.category)).length,
      active: docs.filter((d) => d.status === "approved" || d.status === "under_review").length,
      archived: docs.filter((d) => d.status === "archived").length,
    },
    source: "api",
  };
}
function setDocs(docs: Doc[], total?: number) {
  mockDocs.mockResolvedValue({ data: docs, source: "api" });
  mockSummary.mockResolvedValue(summaryOf(docs, total));
}

import Page from "./page";

const doc = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111", title: "Doc", category: "Circular",
  author: "A", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  tags: [], status: "approved", accessLevel: "internal", version: "1.0", ...over,
});

describe("KnowledgeDashboardPage", () => {
  beforeEach(() => { mockDocs.mockReset(); mockSummary.mockReset(); });

  // GAP-KNOWLEDGE-DASHBOARD-01: no "% of quota" fabricated storage card.
  it("has no fabricated storage/quota card", async () => {
    setDocs([doc()]);
    render(await Page());
    expect(screen.queryByText(/of quota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage usage/i)).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-02: card labels match computation (Active / Archived).
  it("labels match computation: Active and Archived cards", async () => {
    setDocs([doc({ status: "approved" }), doc({ id: "2", status: "archived" }), doc({ id: "3", status: "under_review" })]);
    render(await Page());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Archived").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Due for Archival")).not.toBeInTheDocument();
    expect(screen.queryByText("Under Retention")).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-03: search chips link to /knowledge/search?q=
  it("search chips carry the query param", async () => {
    setDocs([doc()]);
    render(await Page());
    const chip = screen.getByRole("link", { name: "travel policy" });
    expect(chip).toHaveAttribute("href", "/knowledge/search?q=travel%20policy");
    // GAP-KNOWLEDGE-DASHBOARD-03: no dead ?bulk=true link
    expect(screen.queryByRole("link", { name: "Bulk upload" })).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-HOME-02: unified title
  it("uses the unified Knowledge & Documents title", async () => {
    setDocs([doc()]);
    render(await Page());
    expect(screen.getByText("Knowledge & Documents")).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-07 superseded by GAP2-KNOWLEDGE-DASHBOARD-CAP-01:
  // the cards no longer count a page-capped list (so no "first N" note is
  // needed); they show the repository-wide total from the server aggregate.
  it("shows the repository-wide total, not the length of the capped list", async () => {
    const many = Array.from({ length: 50 }, (_, i) => doc({ id: `d-${i}` }));
    setDocs(many, 1234);
    render(await Page());
    expect(screen.getByText("Documents").closest(".stat")).toHaveTextContent("1,234");
    expect(screen.queryByText(/based on the most recent/i)).not.toBeInTheDocument();
  });

  it("shows a dash and an honest note when the aggregate fails", async () => {
    mockDocs.mockResolvedValue({ data: [doc()], source: "api" });
    mockSummary.mockResolvedValue({ data: { total: 0, byStatus: {}, byCategory: [], circulars: 0, active: 0, archived: 0 }, source: "error" });
    render(await Page());
    expect(screen.getByText(/Repository totals are temporarily unavailable/i)).toBeInTheDocument();
  });
});
