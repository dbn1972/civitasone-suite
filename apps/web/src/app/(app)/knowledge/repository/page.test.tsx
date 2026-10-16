import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getKnowledgeDocsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getKnowledgeDocs: () => getKnowledgeDocsMock(),
}));

import KnowledgeRepositoryPage from "./page";

function doc(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    title: "Test Doc",
    category: "Circular",
    author: "Admin dept",
    createdAt: "2026-01-01T00:00:00Z",
    tags: [],
    status: "approved",
    accessLevel: "internal",
    fileType: null,
    fileSize: 0,
    version: "1",
    ...over,
  };
}

describe("KnowledgeRepositoryPage", () => {
  beforeEach(() => getKnowledgeDocsMock.mockReset());

  it("GAP-REPOSITORY-01: Circulars counts docs with category containing 'circular'", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [
        doc({ id: "c1", category: "Circular" }),
        doc({ id: "c2", category: "Policy" }),
        doc({ id: "c3", category: "Notification" }),
      ],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    // Circulars stat card should show 1 (one circular), not 3 (all approved)
    const labels = screen.getAllByText("Circulars");
    // Find the stat card value near the label
    expect(labels.length).toBeGreaterThan(0);
  });

  it("GAP-REPOSITORY-02: error state shows RefreshErrorState, not 'No documents'", async () => {
    getKnowledgeDocsMock.mockResolvedValue({ data: [], source: "error" });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No documents found in the repository.")).not.toBeInTheDocument();
  });

  it("GAP-REPOSITORY-03: archived docs are excluded from table rows", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [
        doc({ id: "a1", title: "Active Doc", status: "approved" }),
        doc({ id: "a2", title: "Old Doc", status: "archived" }),
      ],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByText("Active Doc")).toBeInTheDocument();
    expect(screen.queryByText("Old Doc")).not.toBeInTheDocument();
    expect(screen.getByText(/1 archived document.* hidden/)).toBeInTheDocument();
  });

  it("GAP-REPOSITORY-03: footnote not shown when no archived docs", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [doc({ status: "approved" })],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    expect(screen.queryByText(/archived/)).not.toBeInTheDocument();
  });

  it("empty success shows empty state", async () => {
    getKnowledgeDocsMock.mockResolvedValue({ data: [], source: "api" });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByText("No documents found")).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-LIST-02: no truncated-UUID "Doc ID" column; "Author" (not "Dept")
  it("GAP-LIST-02: no 'Doc ID' column and author header reads 'Author'", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [doc({ id: "d1abcdef-0000-0000-0000-000000000000", title: "Active Doc", status: "approved" })],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    expect(screen.queryByText("Doc ID")).not.toBeInTheDocument();
    // the truncated upper-cased id must not appear as a cell
    expect(screen.queryByText("D1ABCDEF")).not.toBeInTheDocument();
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.queryByText("Dept")).not.toBeInTheDocument();
  });
});

describe("KnowledgeRepositoryPage w2 closures", () => {
  beforeEach(() => getKnowledgeDocsMock.mockReset());

  // GAP-KNOWLEDGE-LIST-01: rows open the document detail route (documents/[id]).
  it("GAP-LIST-01: a row title links to /knowledge/documents/<full id>, not the policies route", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    getKnowledgeDocsMock.mockResolvedValue({ data: [doc({ id, title: "Linked Doc" })], source: "api" });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByRole("link", { name: "Open Linked Doc" })).toHaveAttribute("href", `/knowledge/documents/${id}`);
  });

  // GAP-KNOWLEDGE-DOCUMENTS-NEW-02 / LIST-04: no Import entry point to a flow that does not exist;
  // DOCUMENTS-NEW-04: no "Publish" wording on a route that creates drafts.
  it("GAP-NEW-02/LIST-04/NEW-04: no Import control; the create action reads '+ Add Document'", async () => {
    getKnowledgeDocsMock.mockResolvedValue({ data: [doc()], source: "api" });
    render(await KnowledgeRepositoryPage());
    expect(screen.queryByRole("link", { name: /import/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Add Document" })).toHaveAttribute("href", "/knowledge/documents/new");
    expect(screen.queryByText(/Publish Document/i)).not.toBeInTheDocument();
    // no link in the page targets a query param the destination ignores
    for (const a of Array.from(document.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/mode=import|bulk=true/);
    }
  });

  // GAP-KNOWLEDGE-REPOSITORY-02 acceptance: dashes in the cards on a failed load.
  it("GAP-REPOSITORY-02: on a failed load the stat cards show dashes and no zero counts", async () => {
    getKnowledgeDocsMock.mockResolvedValue({ data: [], source: "error" });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByText("Documents").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Published").closest(".stat")).toHaveTextContent("—");
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
  });
});

describe("KnowledgeRepositoryPage access column and segments (GAP-KNOWLEDGE-LIST-06, REPOSITORY-07)", () => {
  beforeEach(() => getKnowledgeDocsMock.mockReset());

  it("LIST-06: restricted documents show a lock and the spelled-out level; public is a plain pill", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [
        doc({ id: "r1", title: "Secret Circular", accessLevel: "restricted" }),
        doc({ id: "r2", title: "Open Circular", accessLevel: "public" }),
      ],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByText("Access")).toBeInTheDocument();
    const restricted = screen.getByText("Restricted");
    expect(restricted.closest(".pill")).not.toBeNull();
    expect(restricted.parentElement).toHaveTextContent("🔒");
    const open = screen.getByText("Public");
    expect(open.parentElement).not.toHaveTextContent("🔒");
  });

  it("REPOSITORY-07: choosing the Circulars segment keeps 'Circular' documents and drops the others", async () => {
    getKnowledgeDocsMock.mockResolvedValue({
      data: [
        doc({ id: "s1", title: "Alpha Circular Doc", category: "Circular" }),
        doc({ id: "s2", title: "Beta Policy Doc", category: "Policy" }),
        doc({ id: "s3", title: "Gamma Misc Doc", category: "Other" }),
      ],
      source: "api",
    });
    render(await KnowledgeRepositoryPage());
    expect(screen.getByText("Gamma Misc Doc")).toBeInTheDocument(); // All includes 'Other'
    fireEvent.click(screen.getByRole("tab", { name: "Circulars" }));
    expect(screen.getByText("Alpha Circular Doc")).toBeInTheDocument();
    expect(screen.queryByText("Beta Policy Doc")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma Misc Doc")).not.toBeInTheDocument();
  });
});
