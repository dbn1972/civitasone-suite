import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { DepositsTable } from "./treasury/deposits/DepositsTable";
import { DemandGrantsTable } from "./budget/demand-grants/DemandGrantsTable";

const mockedHook = vi.mocked(useSeededResource);
const seed = (data: unknown) => mockedHook.mockReturnValue({ data, offline: false, cachedAt: null, provenance: "live" } as never);

describe("register drill-down links", () => {
  beforeEach(() => mockedHook.mockReset());

  it("deposits: the deposit number opens its detail; a row without an id is not a link (GAP-FINANCE-TREASURY-DEPOSITS-03)", () => {
    seed([
      { id: "dep-1", pdNo: "PD-001", type: "emd", administrator: "Collector", balanceMinor: "1000", currency: "INR", status: "active", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", version: 1 },
      { id: "", pdNo: "PD-NOID", type: "emd", administrator: "Collector", balanceMinor: "1000", currency: "INR", status: "active", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", version: 1 },
    ]);
    render(<DepositsTable deposits={[]} source="api" />);
    expect(screen.getByText("PD-001").closest("a")?.getAttribute("href")).toBe("/finance/treasury/deposits/dep-1");
    expect(screen.getByText("PD-NOID").closest("a")).toBeNull();
  });

  it("demand grants: the demand number opens its head-wise detail (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04)", () => {
    seed([{ id: "dem-1", demandNo: "D-01", service: "Education", amountMinor: "100000", currency: "INR", class: "voted", status: "draft", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", version: 1 }]);
    render(<DemandGrantsTable grants={[]} source="api" />);
    expect(screen.getByText("D-01").closest("a")?.getAttribute("href")).toBe("/finance/budget/demand-grants/dem-1");
  });
});
