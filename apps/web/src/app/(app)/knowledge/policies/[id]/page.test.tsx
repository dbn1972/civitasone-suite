import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const getKnowledgePolicyMock = vi.fn();
const getPolicyAcknowledgementsMock = vi.fn();
vi.mock("../../_data/loaders", () => ({
  getKnowledgePolicy: () => getKnowledgePolicyMock(),
  getPolicyAcknowledgements: () => getPolicyAcknowledgementsMock(),
}));

const getSessionUserIdMock = vi.fn();
const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
  getSessionRoles: () => getSessionRolesMock(),
  KNOWLEDGE_POLICY_APPROVER_ROLES: ["knowledge_admin", "super_admin"],
}));

import Page from "./page";

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    docType: "policy",
    referenceNo: "POL-1",
    title: "Travel Policy",
    status: "published",
    authorId: "author-1",
    approverId: null,
    effectiveDate: "2026-01-01",
    reviewDueDate: "2027-01-01",
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    body: "body text",
    reviewerId: null,
    supersedesId: null,
    publishedAt: "2026-01-01T00:00:00Z",
    createdAt: "2025-12-01T00:00:00Z",
    ...over,
  };
}

describe("Policy detail page", () => {
  beforeEach(() => {
    getKnowledgePolicyMock.mockReset();
    getPolicyAcknowledgementsMock.mockReset();
    getSessionUserIdMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionUserIdMock.mockReturnValue("viewer-1");
    getSessionRolesMock.mockReturnValue(["knowledge_user"]);
  });

  it("GAP-DETAIL-01: raw employee UUIDs are never printed; non-admin sees count only", async () => {
    getKnowledgePolicyMock.mockResolvedValue({ data: policy(), source: "api" });
    getPolicyAcknowledgementsMock.mockResolvedValue({
      data: { acknowledgedCount: 2, employeeIds: ["emp-aaaa-1111", "emp-bbbb-2222"] },
      source: "api",
    });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.queryByText("emp-aaaa-1111")).not.toBeInTheDocument();
    expect(screen.queryByText("emp-bbbb-2222")).not.toBeInTheDocument();
    expect(screen.getByText(/2 employees have acknowledged/)).toBeInTheDocument();
  });

  it("GAP-DETAIL-01: admin also does not see raw UUIDs", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    getKnowledgePolicyMock.mockResolvedValue({ data: policy(), source: "api" });
    getPolicyAcknowledgementsMock.mockResolvedValue({
      data: { acknowledgedCount: 1, employeeIds: ["emp-secret-uuid"] },
      source: "api",
    });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.queryByText("emp-secret-uuid")).not.toBeInTheDocument();
  });

  it("GAP-DETAIL-07: supersedes link renders when supersedesId present", async () => {
    getKnowledgePolicyMock.mockResolvedValue({ data: policy({ supersedesId: "old-1" }), source: "api" });
    getPolicyAcknowledgementsMock.mockResolvedValue({ data: { acknowledgedCount: 0, employeeIds: [] }, source: "api" });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    const link = screen.getByRole("link", { name: /View superseded version/i });
    expect(link).toHaveAttribute("href", "/knowledge/policies/old-1");
  });

  it("GAP-DETAIL-05: already-acknowledged user sees the acknowledged note, not the button", async () => {
    getSessionUserIdMock.mockReturnValue("emp-123");
    getKnowledgePolicyMock.mockResolvedValue({ data: policy(), source: "api" });
    getPolicyAcknowledgementsMock.mockResolvedValue({
      data: { acknowledgedCount: 1, employeeIds: ["emp-123"] },
      source: "api",
    });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText(/You have acknowledged this document/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /I have read & understood/ })).not.toBeInTheDocument();
  });
});

describe("Policy detail page w2 closures", () => {
  beforeEach(() => {
    getKnowledgePolicyMock.mockReset();
    getPolicyAcknowledgementsMock.mockReset();
    getSessionUserIdMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionUserIdMock.mockReturnValue("viewer-1");
    getSessionRolesMock.mockReturnValue(["knowledge_user"]);
    getPolicyAcknowledgementsMock.mockResolvedValue({ data: { acknowledgedCount: 0, employeeIds: [] }, source: "api" });
  });

  it("GAP-POLICIES-05: a draft without referenceNo shows 'Unassigned' in the header, never a truncated id", async () => {
    getKnowledgePolicyMock.mockResolvedValue({ data: policy({ id: "abcdef01-0000-0000-0000-000000000000", referenceNo: null, status: "draft" }), source: "api" });
    render(await Page({ params: Promise.resolve({ id: "abcdef01" }) }));
    expect(screen.getByText(/Unassigned/)).toBeInTheDocument();
    expect(screen.queryByText(/ABCDEF01/)).not.toBeInTheDocument();
  });

  it("GAP-DETAIL-04: the approval trail shows author, reviewer and approver without printing identifiers, and states the maker-checker separation", async () => {
    getKnowledgePolicyMock.mockResolvedValue({
      data: policy({ authorId: "viewer-1", reviewerId: "rev-uuid-9999", approverId: "app-uuid-8888" }),
      source: "api",
    });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText("Approval trail")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument(); // the viewer is the author
    expect(screen.getAllByText("Another user (recorded in the audit log)")).toHaveLength(2);
    expect(screen.queryByText("rev-uuid-9999")).not.toBeInTheDocument();
    expect(screen.queryByText("app-uuid-8888")).not.toBeInTheDocument();
    expect(screen.getByText(/approver is a different person from the author/)).toBeInTheDocument();
  });

  it("GAP-DETAIL-04: an unapproved draft shows 'Not yet assigned' for approver and no separation note", async () => {
    getKnowledgePolicyMock.mockResolvedValue({ data: policy({ status: "draft", approverId: null, reviewerId: null }), source: "api" });
    render(await Page({ params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getAllByText("Not yet assigned")).toHaveLength(2);
    expect(screen.queryByText(/different person from the author/)).not.toBeInTheDocument();
  });
});
