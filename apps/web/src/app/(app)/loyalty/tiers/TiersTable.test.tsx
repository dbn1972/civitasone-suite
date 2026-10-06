import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { TiersTable } from "./TiersTable";
import type { LoyaltyTierRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function seed(rows: LoyaltyTierRow[], provenance = "live") {
  mockedHook.mockReturnValue({
    data: rows as never,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance,
  } as never);
}

const sample: LoyaltyTierRow[] = [
  {
    id: "t1111111-1111-4111-8111-111111111111",
    programId: "ab12cd34-0000-4000-8000-000000000001",
    name: "Gold",
    level: 3,
    minPointsThreshold: "100000",
    benefits: { loungeAccess: true, bonusMultiplier: 2 },
  },
];

beforeEach(() => seed(sample));

describe("TiersTable (GAP-LOYALTY-TIERS-01/03)", () => {
  it("TIERS-01: lists tier name + threshold + benefits (tier data, not programme rows)", () => {
    render(<TiersTable rows={sample} source="api" />);
    expect(screen.getByRole("columnheader", { name: "Tier" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Min points" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Benefits" })).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("1,00,000")).toBeInTheDocument();
    expect(screen.getByText(/loungeAccess/)).toBeInTheDocument();
  });

  it("TIERS-03: no full-UUID programme id is shown (shortened)", () => {
    render(<TiersTable rows={sample} source="api" />);
    expect(screen.getByText("ab12cd34")).toBeInTheDocument();
    expect(screen.queryByText("ab12cd34-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });

  it("empty state when no tiers defined", () => {
    seed([], "live");
    render(<TiersTable rows={[]} source="api" />);
    expect(screen.getByText("No tiers defined")).toBeInTheDocument();
  });
});
