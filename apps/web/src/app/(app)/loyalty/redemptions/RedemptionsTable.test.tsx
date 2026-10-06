import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { RedemptionsTable } from "./RedemptionsTable";
import type { LoyaltyRedemptionRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyRedemptionRow[], provenance = "live") {
  mockedHook.mockReturnValue({
    data: rows as never,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance,
  } as never);
}

const sample: LoyaltyRedemptionRow[] = [
  {
    id: "r1111111-1111-4111-8111-111111111111",
    memberId: null,
    enrolmentId: "e1",
    points: "1200",
    rewardType: "POINTS_REDEEM",
    status: "pending",
    version: 1,
    redeemedAt: "2026-09-10T05:00:00.000Z",
    voidedAt: null,
  },
  {
    id: "r2222222-2222-4222-8222-222222222222",
    memberId: null,
    enrolmentId: "e2",
    points: "500",
    rewardType: "",
    status: "voided",
    version: 2,
    redeemedAt: "2026-09-11T05:00:00.000Z",
    voidedAt: "2026-09-12T05:00:00.000Z",
  },
];

beforeEach(() => seed(sample));

describe("RedemptionsTable (GAP-LOYALTY-REDEMPTIONS-02/03)", () => {
  it("REDEMPTIONS-02: shows Reward, Points, Requested columns", () => {
    render(<RedemptionsTable rows={sample} source="api" />);
    expect(screen.getByRole("columnheader", { name: "Reward" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Points" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Requested" })).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("REDEMPTIONS-03: reward type humanised (not raw token), missing reward shows '—' not an id", () => {
    render(<RedemptionsTable rows={sample} source="api" />);
    expect(screen.getByText("Points Redeem")).toBeInTheDocument();
    expect(screen.queryByText("POINTS_REDEEM")).not.toBeInTheDocument();
    // the row with null rewardType must not fall back to its UUID
    expect(screen.queryByText(/r2222222-2222/)).not.toBeInTheDocument();
  });

  it("void action is hidden without manage rights and shown (for pending) with them", () => {
    const { unmount } = render(<RedemptionsTable rows={sample} source="api" canManage={false} />);
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    unmount();
    seed(sample);
    render(<RedemptionsTable rows={sample} source="api" canManage />);
    expect(screen.getAllByRole("button", { name: "Void" }).length).toBe(1); // only the pending row
  });

  it("error-no-data renders a retry state, not an empty nudge", () => {
    seed([], "error-no-data");
    render(<RedemptionsTable rows={[]} source="error" />);
    expect(screen.getByText(/couldn't load redemptions/i)).toBeInTheDocument();
    expect(screen.queryByText("No redemptions")).not.toBeInTheDocument();
  });
});
