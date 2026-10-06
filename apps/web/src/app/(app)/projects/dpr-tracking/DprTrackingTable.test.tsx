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
