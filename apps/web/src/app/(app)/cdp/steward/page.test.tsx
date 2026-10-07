import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// GAP-CDP-STEWARD-01: the page reads the session roles server-side and only
// enables the Approve/Reject controls for a steward. cdp-service's
// POST /v1/cdp/steward/decide is the real authority (403 otherwise); this
// verifies the defence-in-depth read-side gate is wired from the real roles.

let mockRoles: string[] = ["cdp_steward"];
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles };
});

vi.mock("@/lib/cdp/steward", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cdp/steward")>();
  return {
    ...actual,
    getStewardQueue: vi.fn().mockResolvedValue({
      source: "api",
      data: [{
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        tenantId: "11111111-0000-0000-0000-000000000001",
        sourceProfileId: "bbbbbbbb-0000-0000-0000-000000000002",
        targetProfileId: "cccccccc-0000-0000-0000-000000000003",
        confidence: "0.90", matchReason: "email match", status: "pending",
        decidedBy: null, decidedAt: null, decisionReason: null, createdAt: "2026-08-20T10:00:00.000Z",
      }],
    }),
    getProfileSummary: vi.fn().mockResolvedValue(null),
  };
});

import Page from "./page";

describe("CDP steward page — role gate (GAP-CDP-STEWARD-01)", () => {
  beforeEach(() => { mockRoles = ["cdp_steward"]; });

  it("offers Approve/Reject to a steward", async () => {
    render(Page());
    await waitFor(() => expect(screen.getByText("email match")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Approve merge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("hides Approve/Reject from a non-steward (plain cdp_user)", async () => {
    mockRoles = ["cdp_user"];
    render(Page());
    await waitFor(() => expect(screen.getByText("email match")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve merge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });
});
