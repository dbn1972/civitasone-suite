import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
