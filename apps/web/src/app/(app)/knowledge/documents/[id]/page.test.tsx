import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(),
}));

const mockDoc = vi.fn();
vi.mock("../../_data/loaders", () => ({
  getKnowledgeDocument: (...a: unknown[]) => mockDoc(...a),
}));

import Page from "./page";

const doc = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111", tenantId: "t1", title: "Annual Leave Policy",
  category: "Policy", status: "approved", tags: ["leave"], accessLevel: "internal",
  fileType: "pdf", fileSize: 12345, author: "Admin", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", version: 2, ...over,
});

describe("Document detail page (LIST-01)", () => {
  beforeEach(() => mockDoc.mockReset());

  it("renders document details with title and metadata", async () => {
    mockDoc.mockResolvedValue({ data: doc(), source: "api" });
    render(await Page({ params: { id: "11111111-1111-1111-1111-111111111111" } }));
    expect(screen.getByText("Annual Leave Policy")).toBeInTheDocument();
    expect(screen.getByText("Policy · v2")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("leave")).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-LIST-06: restricted access shows lock icon
  it("shows lock icon for restricted access level", async () => {
    mockDoc.mockResolvedValue({ data: doc({ accessLevel: "restricted" }), source: "api" });
    render(await Page({ params: { id: "11111111-1111-1111-1111-111111111111" } }));
    expect(screen.getByText("🔒")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
  });

  it("shows service error state when document is null + error", async () => {
    mockDoc.mockResolvedValue({ data: null, source: "error" });
    render(await Page({ params: { id: "nonexistent" } }));
    expect(screen.getByText("Could not load document")).toBeInTheDocument();
  });
});
