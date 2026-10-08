import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DprTrackingTable, type DprRow } from "./DprTrackingTable";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({
    data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live",
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const row: DprRow = {
  dprNo: "DPR-001",
  projectId: "p-42",
  projectTitle: "Rural Roads",
  submittedBy: "11112222-3333-4444-5555-666677778888",
  submittedDate: "2026-03-05",
  estimatedCost: "12.50",
  status: "under review",
  reviewingAuthority: "Chief Engineer",
};

describe("DprTrackingTable (GAP-PROJECTS-DPR-TRACKING-03/04)", () => {
  it("formats the submitted date with the shared Indian date formatter", () => {
    render(<DprTrackingTable rows={[row]} source="api" />);
    expect(screen.getByText("05 Mar 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-03-05")).not.toBeInTheDocument();
  });

  it("masks the opaque submittedBy identifier rather than showing the raw UUID", () => {
    render(<DprTrackingTable rows={[row]} source="api" />);
    expect(screen.getByText("•••• 8888")).toBeInTheDocument();
    expect(screen.queryByText("11112222-3333-4444-5555-666677778888")).not.toBeInTheDocument();
  });

  it("links each DPR row to its project", () => {
    render(<DprTrackingTable rows={[row]} source="api" />);
    const link = screen.getByRole("link", { name: /Open Rural Roads/i });
    expect(link).toHaveAttribute("href", "/projects/p-42");
  });
});

describe("DprTrackingTable actions (GAP-PROJECTS-DPR-TRACKING-01)", () => {
  const withId = (status: string): DprRow => ({ ...row, id: "dpr-1", status });

  it("shows NO action controls to a non-reviewer (canReview=false)", () => {
    render(<DprTrackingTable rows={[withId("submitted")]} source="api" />);
    expect(screen.queryAllByRole("button", { name: "Start review" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Approve" })).toHaveLength(0);
  });

  it("offers only 'Start review' on a submitted DPR to a reviewer", () => {
    render(<DprTrackingTable rows={[withId("submitted")]} source="api" canReview />);
    expect(screen.getAllByRole("button", { name: "Start review" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "Approve" })).toHaveLength(0);
  });

  it("offers Approve and Return for revision on an under_review DPR to a reviewer", () => {
    render(<DprTrackingTable rows={[withId("under_review")]} source="api" canReview />);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Return for revision" }).length).toBeGreaterThan(0);
  });

  it("offers no actions on a terminal (approved) DPR even to a reviewer", () => {
    render(<DprTrackingTable rows={[withId("approved")]} source="api" canReview />);
    expect(screen.queryAllByRole("button", { name: "Start review" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Approve" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Return for revision" })).toHaveLength(0);
  });

  it("renders a returned (revision) DPR with the 'Returned for revision' label", () => {
    render(<DprTrackingTable rows={[withId("revision")]} source="api" />);
    expect(screen.getByText("Returned for revision")).toBeInTheDocument();
  });
});
