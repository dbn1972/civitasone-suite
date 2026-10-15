import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { KnowledgeSearchClient } from "./SearchClient";

const docs = [
  { id: "1", title: "Travel Policy 2024", category: "Policy", author: "A", createdAt: "2026-01-01T00:00:00Z", tags: ["travel"], status: "approved", accessLevel: "internal", version: "1.0" },
  { id: "2", title: "Procurement SOP", category: "SOP", author: "B", createdAt: "2026-01-01T00:00:00Z", tags: [], status: "approved", accessLevel: "internal", version: "1.0" },
];

describe("KnowledgeSearchClient (DASHBOARD-03)", () => {
  // GAP-KNOWLEDGE-DASHBOARD-03: initialQuery prefills and immediately runs the search.
  it("prefills and runs the search from initialQuery", () => {
    render(<KnowledgeSearchClient initialDocs={docs} initialQuery="travel" />);
    expect(screen.getByLabelText("Search query")).toHaveValue("travel");
    // Result for Travel Policy should be present; Procurement SOP should not match
    expect(screen.getByText("Travel Policy 2024")).toBeInTheDocument();
    expect(screen.queryByText("Procurement SOP")).not.toBeInTheDocument();
  });

  it("shows the start state when no initialQuery", () => {
    render(<KnowledgeSearchClient initialDocs={docs} />);
    expect(screen.getByText("Search the knowledge repository")).toBeInTheDocument();
  });
});

describe("KnowledgeSearchClient result links (GAP-KNOWLEDGE-SEARCH-04)", () => {
  it("Given a matching result, then its title links to the document detail route and encodes the id", () => {
    render(<KnowledgeSearchClient initialDocs={docs} initialQuery="travel" />);
    expect(screen.getByRole("link", { name: "Travel Policy 2024" })).toHaveAttribute("href", "/knowledge/documents/1");
  });

  it("Given a q param, results are shown immediately without a second submit", () => {
    render(<KnowledgeSearchClient initialDocs={docs} initialQuery="procurement" />);
    expect(screen.getByText("Procurement SOP")).toBeInTheDocument();
  });
});

describe("KnowledgeSearchClient segments (GAP-KNOWLEDGE-SEARCH-03, SEARCH-05)", () => {
  const withFiles = [
    { ...docs[0]!, id: "f1", title: "Travel Guide PDF", fileType: "pdf" },
    { ...docs[0]!, id: "f2", title: "Travel Note", fileType: undefined },
    { ...docs[0]!, id: "f3", title: "Travel Old Policy", status: "archived" },
  ];

  it("SEARCH-03: selecting Files keeps only documents with a fileType; the column header is Status", () => {
    render(<KnowledgeSearchClient initialDocs={withFiles} initialQuery="travel" />);
    expect(screen.getByText("Status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByText("Travel Guide PDF")).toBeInTheDocument();
    expect(screen.queryByText("Travel Note")).not.toBeInTheDocument();
  });

  it("SEARCH-05: an archived document ranks below a live one with the same match, and is still found", () => {
    render(<KnowledgeSearchClient initialDocs={withFiles} initialQuery="travel" />);
    const order = screen.getAllByRole("link").map((a) => a.textContent);
    expect(order.indexOf("Travel Note")).toBeLessThan(order.indexOf("Travel Old Policy"));
    expect(order).toContain("Travel Old Policy");
  });
});
