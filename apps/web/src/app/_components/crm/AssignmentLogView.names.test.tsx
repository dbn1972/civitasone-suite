/**
 * GAP-CRM display: AssignmentLogView must render resolved owner / assigned-by names and
 * never a raw UUID (an unresolved opaque id reads "Unknown user").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AssignmentLogView } from "./AssignmentLogView";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return { ...actual, getAssignmentLog: vi.fn() };
});
beforeEach(() => vi.mocked(as.getAssignmentLog).mockReset());

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

describe("AssignmentLogView resolves actor ids to names", () => {
  it("shows the resolved owner + assigned-by names, not raw uuids", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({
      data: [{ ownerId: UUID, ruleId: "r1", method: "manual", assignedAt: "2026-01-01T00:00:00Z", assignedBy: UUID2, ownerName: "Asha Rao", assignedByName: "Ravi Das" }],
      source: "api",
    });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0));
    expect(screen.getByText(/by Ravi Das/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UUID2))).not.toBeInTheDocument();
  });

  it("shows 'Unknown user' for an unresolved uuid owner, never the raw id", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({
      data: [{ ownerId: UUID, ruleId: "r1", method: "auto", assignedAt: "2026-01-01T00:00:00Z", assignedBy: UUID2 }],
      source: "api",
    });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getAllByText("Unknown user").length).toBeGreaterThan(0));
    expect(screen.queryByText(new RegExp(UUID))).not.toBeInTheDocument();
  });
});
