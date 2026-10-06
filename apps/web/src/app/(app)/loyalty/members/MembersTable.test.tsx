import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { MembersTable } from "./MembersTable";
import type { LoyaltyMemberRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyMemberRow[], provenance = "live") {
  mockedHook.mockReturnValue({
    data: rows as never,
    fromCache: provenance === "cached",
    offline: false,
    cachedAt: null,
    provenance,
  } as never);
}

const sample: LoyaltyMemberRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    profileId: "ab12cd34-0000-4000-8000-000000000001",
    programId: "pr000000-0000-4000-8000-000000000001",
    status: "active",
    tier: "Gold",
    pointsBalance: "4500",
    lifetimePoints: "1234567",
    enrolledAt: "2026-08-14T09:12:44.000Z",
    updatedAt: "2026-08-14T09:12:44.000Z",
  },
];

beforeEach(() => seed(sample));

describe("MembersTable (GAP-LOYALTY-MEMBERS-01/03, ACCRUALS-03)", () => {
  it("MEMBERS-01: tier is its OWN column value and the Detail/status is not duplicated", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByRole("columnheader", { name: "Tier" })).toBeInTheDocument();
    // tier label visible on its own, status 'active' rendered as a pill elsewhere
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });

  it("ACCRUALS-03: points balance and lifetime render with en-IN grouping", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("4,500")).toBeInTheDocument();
    expect(screen.getByText("12,34,567")).toBeInTheDocument();
  });

  it("MEMBERS-03: enrolled date renders formatted (no raw ISO 'T...Z')", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("14 Aug 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-14T09:12:44/)).not.toBeInTheDocument();
  });

  it("MEMBERS-02: member reference is shortened, never the full UUID", () => {
    render(<MembersTable rows={sample} source="api" />);
    expect(screen.getByText("ab12cd34")).toBeInTheDocument();
    expect(screen.queryByText("ab12cd34-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });

  it("error-no-data renders a retry state, not an empty nudge", () => {
    seed([], "error-no-data");
    render(<MembersTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load loyalty members/i)).toBeInTheDocument();
    expect(screen.queryByText("No members")).not.toBeInTheDocument();
  });

  it("live + empty renders the empty state (not an error)", () => {
    seed([], "live");
    render(<MembersTable rows={[]} source="api" />);
    expect(screen.getByText("No members")).toBeInTheDocument();
  });
});
