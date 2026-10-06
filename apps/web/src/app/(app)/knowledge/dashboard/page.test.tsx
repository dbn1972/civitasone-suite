import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const mockDocs = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getKnowledgeDocs: (...a: unknown[]) => mockDocs(...a),
}));

import Page from "./page";

const doc = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111", title: "Doc", category: "Circular",
  author: "A", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  tags: [], status: "approved", accessLevel: "internal", version: "1.0", ...over,
});

describe("KnowledgeDashboardPage", () => {
  beforeEach(() => mockDocs.mockReset());

  // GAP-KNOWLEDGE-DASHBOARD-01: no "% of quota" fabricated storage card.
  it("has no fabricated storage/quota card", async () => {
    mockDocs.mockResolvedValue({ data: [doc()], source: "api" });
    render(await Page());
    expect(screen.queryByText(/of quota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage usage/i)).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-02: card labels match computation (Active / Archived).
  it("labels match computation: Active and Archived cards", async () => {
    mockDocs.mockResolvedValue({
      data: [doc({ status: "approved" }), doc({ id: "2", status: "archived" }), doc({ id: "3", status: "under_review" })],
      source: "api",
    });
    render(await Page());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Archived").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Due for Archival")).not.toBeInTheDocument();
    expect(screen.queryByText("Under Retention")).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-03: search chips link to /knowledge/search?q=
  it("search chips carry the query param", async () => {
    mockDocs.mockResolvedValue({ data: [doc()], source: "api" });
    render(await Page());
    const chip = screen.getByRole("link", { name: "travel policy" });
    expect(chip).toHaveAttribute("href", "/knowledge/search?q=travel%20policy");
    // GAP-KNOWLEDGE-DASHBOARD-03: no dead ?bulk=true link
    expect(screen.queryByRole("link", { name: "Bulk upload" })).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-HOME-02: unified title
  it("uses the unified Knowledge & Documents title", async () => {
    mockDocs.mockResolvedValue({ data: [doc()], source: "api" });
    render(await Page());
    expect(screen.getByText("Knowledge & Documents")).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DASHBOARD-07: cap-awareness note when the list hits the page limit
  it("shows a 'first N documents' note when the list is page-capped (>=50)", async () => {
    const many = Array.from({ length: 50 }, (_, i) => doc({ id: `d-${i}` }));
    mockDocs.mockResolvedValue({ data: many, source: "api" });
    render(await Page());
    expect(screen.getByText(/based on the most recent 50 documents/i)).toBeInTheDocument();
  });

  it("does NOT show the cap note for a small repository", async () => {
    mockDocs.mockResolvedValue({ data: [doc(), doc({ id: "2" })], source: "api" });
    render(await Page());
    expect(screen.queryByText(/based on the most recent/i)).not.toBeInTheDocument();
  });
});
