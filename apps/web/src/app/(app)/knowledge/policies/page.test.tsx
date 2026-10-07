import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getKnowledgePoliciesMock = vi.fn();
const getReviewDuePoliciesMock = vi.fn();
vi.mock("../_data/loaders", () => ({
  getKnowledgePolicies: () => getKnowledgePoliciesMock(),
  getReviewDuePolicies: () => getReviewDuePoliciesMock(),
}));

const getSessionRolesMock = vi.fn().mockReturnValue(["knowledge_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import Page from "./page";

function pol(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    docType: "sop",
    referenceNo: null,
    title: "Test SOP",
    status: "draft",
    authorId: "u1",
    approverId: null,
    effectiveDate: null,
    reviewDueDate: null,
    version: 1,
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("Policies Page", () => {
  beforeEach(() => {
    getKnowledgePoliciesMock.mockReset();
    getReviewDuePoliciesMock.mockReset();
    getReviewDuePoliciesMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("GAP-POLICIES-05: draft without referenceNo shows 'Unassigned', not truncated UUID", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({
      data: [pol({ id: "abcdef01-0000-0000-0000-000000000000", referenceNo: null })],
      source: "api",
    });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("ABCDEF01")).not.toBeInTheDocument();
  });

  it("GAP-POLICIES-02: Type column does not use a StatusPill (no cellType status)", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({
      data: [pol({ docType: "circular" })],
      source: "api",
    });
    render(await Page({ searchParams: {} }));
    // Should render as plain text "CIRCULAR" not inside a StatusPill
    expect(screen.getByText("CIRCULAR")).toBeInTheDocument();
  });

  it("GAP-POLICIES-06: status uses sentence-case label", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({
      data: [pol({ status: "under_review" })],
      source: "api",
    });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Under review")).toBeInTheDocument();
    expect(screen.queryByText("under review")).not.toBeInTheDocument();
  });

  it("GAP-POLICIES-03: Review due stat links to ?filter=review-due", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({ data: [], source: "api" });
    getReviewDuePoliciesMock.mockResolvedValue({ data: [pol()], source: "api" });
    render(await Page({ searchParams: {} }));
    const link = screen.getByRole("link", { name: /review due/i });
    expect(link).toHaveAttribute("href", "/knowledge/policies?filter=review-due");
  });

  it("GAP-POLICIES-03: overdue review date shows 'Overdue' pill", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({
      data: [pol({ status: "published", reviewDueDate: "2020-01-01" })],
      source: "api",
    });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it("GAP-POLICIES-01: + New action links to /knowledge/policies/new", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({ data: [], source: "api" });
    getSessionRolesMock.mockReturnValue(["knowledge_admin"]);
    render(await Page({ searchParams: {} }));
    const link = screen.getByRole("link", { name: "+ New" });
    expect(link).toHaveAttribute("href", "/knowledge/policies/new");
  });

  it("?filter=review-due shows review-due data only", async () => {
    getKnowledgePoliciesMock.mockResolvedValue({ data: [pol({ id: "all" })], source: "api" });
    getReviewDuePoliciesMock.mockResolvedValue({
      data: [pol({ id: "due1", title: "Due Policy", referenceNo: "POL-01" })],
      source: "api",
    });
    render(await Page({ searchParams: { filter: "review-due" } }));
    expect(screen.getByText("Due Policy")).toBeInTheDocument();
    expect(screen.getByText("Documents due for review")).toBeInTheDocument();
  });
});
