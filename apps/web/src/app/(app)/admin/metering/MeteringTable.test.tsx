import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeteringTable } from "./MeteringTable";
import { meteringStats, meterStatusTone, toMeterRows } from "./meteringStats";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

const m = (status: string, tenant = status) => ({ tenant, apiCalls: 10, storage: "1 GB", users: 3, billingPeriod: "2026-09", amount: 100, status });
function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({ data, fromCache: provenance === "cached", offline: false, cachedAt: null, provenance } as never);
}

describe("meteringStats / tones (GAP-ADMIN-METERING-05/-06)", () => {
  it("a draft row is not Pending; unknown statuses surface as Other", () => {
    expect(meteringStats(toMeterRows([m("billed"), m("overdue"), m("pending"), m("draft"), m("weird")]))).toEqual({ total: 5, billed: 1, overdue: 1, pending: 1, other: 2 });
  });
  it("'billed' is a good tone", () => expect(meterStatusTone("billed")).toBe("good"));
});

describe("MeteringTable (GAP-ADMIN-METERING-03/-04)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cached provenance with empty server rows: Metered Tenants equals the table row count", () => {
    seeded([m("billed", "t1"), m("pending", "t2")], "cached");
    render(<MeteringTable meters={[]} />);
    expect(screen.getByText("Metered Tenants").parentElement).toHaveTextContent("2");
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("error-no-data: dashes + retry, no 'No metering data'", () => {
    seeded([], "error-no-data");
    render(<MeteringTable meters={[]} source="error" errorStatus={500} />);
    expect(screen.getByText("Metered Tenants").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No metering data")).not.toBeInTheDocument();
  });

  it("live empty shows 0", () => {
    seeded([], "live");
    render(<MeteringTable meters={[]} />);
    expect(screen.getByText("Metered Tenants").parentElement).toHaveTextContent("0");
  });
});
