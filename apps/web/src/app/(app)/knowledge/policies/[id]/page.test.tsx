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
    render(await Page({ params: { id: "p1" } }));
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
    render(await Page({ params: { id: "p1" } }));
    expect(screen.queryByText("emp-secret-uuid")).not.toBeInTheDocument();
  });

  it("GAP-DETAIL-07: supersedes link renders when supersedesId present", async () => {
    getKnowledgePolicyMock.mockResolvedValue({ data: policy({ supersedesId: "old-1" }), source: "api" });
    getPolicyAcknowledgementsMock.mockResolvedValue({ data: { acknowledgedCount: 0, employeeIds: [] }, source: "api" });
    render(await Page({ params: { id: "p1" } }));
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
    render(await Page({ params: { id: "p1" } }));
    expect(screen.getByText(/You have acknowledged this document/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /I have read & understood/ })).not.toBeInTheDocument();
  });
});
