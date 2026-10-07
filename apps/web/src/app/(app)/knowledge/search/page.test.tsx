import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getKnowledgeDocsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getKnowledgeDocs: () => getKnowledgeDocsMock(),
}));

import KnowledgeSearchPage from "./page";

describe("KnowledgeSearchPage", () => {
  beforeEach(() => getKnowledgeDocsMock.mockReset());

  it("GAP-SEARCH-02: failed fetch shows retry state, not 'No documents found'", async () => {
    getKnowledgeDocsMock.mockResolvedValue({ data: [], source: "error" });
    render(await KnowledgeSearchPage({ searchParams: {} }));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
  });

  it("GAP-SEARCH-01: subtitle does not claim full-text or all modules", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [{
        id: "d1",
        title: "Travel",
        category: "Policy",
        author: null,
        createdAt: "2026-01-01T00:00:00Z",
        tags: [],
        status: "approved",
        accessLevel: "internal",
        version: "1",
        fileType: null,
      }],
      source: "api",
    });
    render(await KnowledgeSearchPage({ searchParams: {} }));
    // Old misleading text should be gone
    expect(screen.queryByText(/Full-text/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/all documents & modules/i)).not.toBeInTheDocument();
    // Honest text present
    expect(screen.getByText(/Search document titles, categories, authors and tags/)).toBeInTheDocument();
  });

  it("GAP-SEARCH-04: initialQuery from searchParams.q auto-triggers search", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [{
        id: "d1",
        title: "Travel Policy",
        category: "Policy",
        author: "HR",
        createdAt: "2026-01-01T00:00:00Z",
        tags: [],
        status: "approved",
        accessLevel: "internal",
        version: "1",
        fileType: null,
      }],
      source: "api",
    });
    render(await KnowledgeSearchPage({ searchParams: { q: "Travel" } }));
    // Should show results without user having to press Enter; query chip shows count
    expect(screen.getByText(/Results/)).toBeInTheDocument();
  });
});
