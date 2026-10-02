import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { AssetsTable } from "./AssetsTable";
import { computeAssetStats } from "./assetStats";

const A = (id: string, type: string, status = "active") => ({
  id, assetCode: `C-${id}`, name: `Asset ${id}`, type, status, purchaseCost: 100000, currentValue: 80000,
});

describe("computeAssetStats", () => {
  it("summarises count, active share and blocks in paise", () => {
    expect(computeAssetStats([A("1", "it"), A("2", "it", "maintenance")])).toEqual({ count: 2, activePct: 50, grossBlock: 200000, netBlock: 160000 });
    expect(computeAssetStats([])).toEqual({ count: 0, activePct: 0, grossBlock: 0, netBlock: 0 });
  });
});

describe("AssetsTable stats (GAP-ASSETS-LIST-02)", () => {
  beforeEach(() => seeded.mockReset());

  it("computes the tiles from the cached rows the table shows, not the empty server prop", () => {
    seeded.mockReturnValue({ data: [A("1", "it"), A("2", "fixed"), A("3", "fixed")], provenance: "cached", offline: true, cachedAt: "2026-10-01T00:00:00Z" });
    render(<AssetsTable assets={[]} source="error" />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("₹3,000.00")).toBeInTheDocument();
    expect(screen.getByText("Asset 3")).toBeInTheDocument();
  });

  it("shows — rather than zeros when the fetch failed and nothing is cached", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<AssetsTable assets={[]} source="error" />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("restricts to the type filter for the fixed register (GAP-ASSETS-FIXED-ASSETS-01)", () => {
    seeded.mockReturnValue({ data: [A("1", "it"), A("2", "fixed")], provenance: "live", offline: false, cachedAt: null });
    render(<AssetsTable assets={[]} typeFilter="fixed" />);
    expect(screen.getByText("Asset 2")).toBeInTheDocument();
    expect(screen.queryByText("Asset 1")).not.toBeInTheDocument();
    expect(screen.getByText("Fixed Assets")).toBeInTheDocument();
  });
});
