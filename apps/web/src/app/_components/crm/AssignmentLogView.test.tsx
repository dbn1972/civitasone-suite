import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AssignmentLogView } from "./AssignmentLogView";
import * as as from "@/lib/crm/assignment";

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return { ...actual, getAssignmentLog: vi.fn() };
});
beforeEach(() => vi.mocked(as.getAssignmentLog).mockReset());

const entry: as.AssignmentLogEntry = {
  ownerId: "u1", ruleId: "r1", method: "auto",
  assignedAt: new Date(Date.now() - 90 * 60000).toISOString(), assignedBy: "system",
};

describe("AssignmentLogView (AS-001/002 history + AS-004 ageing)", () => {
  it("shows the saved-info badge and dashes on a failed load", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({ data: [], source: "error" });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText(/assignment history unavailable/i)).toBeInTheDocument();
    // ageing header must not fabricate a value.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders owner, ageing and awaiting-acceptance state", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({ data: [entry], source: "api" });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getAllByText("u1").length).toBeGreaterThan(0));
    expect(screen.getByText(/awaiting acceptance/i)).toBeInTheDocument();
    expect(screen.getByText(/auto \(rules\)/i)).toBeInTheDocument();
    expect(screen.getByText(/1h 30m/)).toBeInTheDocument();
  });

  it("shows accepted state when the latest entry has acceptedAt", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({ data: [{ ...entry, acceptedAt: "2026-08-04T10:00:00Z" }], source: "api" });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/accepted/i));
    expect(screen.queryByText(/awaiting acceptance/i)).not.toBeInTheDocument();
  });

  it("shows the not-assigned empty state on an empty (live) log", async () => {
    vi.mocked(as.getAssignmentLog).mockResolvedValue({ data: [], source: "api" });
    render(<AssignmentLogView leadId="l1" />);
    await waitFor(() => expect(screen.getByText(/not assigned yet/i)).toBeInTheDocument());
  });
});
