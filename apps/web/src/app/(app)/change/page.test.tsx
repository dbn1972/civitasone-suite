import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChangeRequest } from "./_data/types";

const getChangeRequests = vi.fn();
vi.mock("./_data/loaders", () => ({ getChangeRequests: () => getChangeRequests() }));

import Page from "./page";

function req(id: string, status: ChangeRequest["status"]): ChangeRequest {
  return {
    id, title: `Change ${id}`, type: "normal", risk: "medium", affectedServices: [],
    description: "", rollbackPlan: null, status, requestedBy: "r", approvedBy: null,
    approvedAt: null, rejectedReason: null, windowStart: null, windowEnd: null,
    releaseNotes: null, pirOutcome: null, pirNotes: null, pirAt: null,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "",
  };
}

const ROWS: ChangeRequest[] = [
  req("a1", "submitted"),
  req("a2", "submitted"),
  req("a3", "scheduled"),
  req("a4", "completed"),
];

describe("change home page (GAP-CHANGE-HOME-03 / -02 error state)", () => {
  beforeEach(() => getChangeRequests.mockReset());

  it("HOME-03: ?status=submitted shows only submitted rows and the count matches the stat", async () => {
    getChangeRequests.mockResolvedValue({ data: ROWS, source: "api" });
    render(await Page({ searchParams: { status: "submitted" } }));
    // The 'Awaiting CAB' stat value is 2.
    const awaitingTab = screen.getByRole("tab", { name: /Awaiting CAB \(2\)/ });
    expect(awaitingTab).toHaveAttribute("aria-selected", "true");
    // Only the two submitted rows render (completed/scheduled excluded).
    expect(screen.getByText("Change a1")).toBeInTheDocument();
    expect(screen.getByText("Change a2")).toBeInTheDocument();
    expect(screen.queryByText("Change a3")).not.toBeInTheDocument();
    expect(screen.queryByText("Change a4")).not.toBeInTheDocument();
  });

  it("HOME-03: the 'Awaiting CAB' stat card links to ?status=submitted", async () => {
    getChangeRequests.mockResolvedValue({ data: ROWS, source: "api" });
    render(await Page({ searchParams: {} }));
    const link = screen.getByRole("link", { name: /Awaiting CAB/ });
    expect(link).toHaveAttribute("href", "/change?status=submitted");
  });

  it("error state renders '—' for the stat values, never a reassuring 0", async () => {
    getChangeRequests.mockResolvedValue({ data: [], source: "error" });
    render(await Page({ searchParams: {} }));
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
