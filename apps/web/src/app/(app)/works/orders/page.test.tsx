import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "@/app/_components/ds";
import { mapOrders, type OrderRow } from "./mapOrders";

// GAP-WORKS-ORDERS-01/02/03/05: these assert the NEW behaviour and fail on the
// old orders/page.tsx (which used a local lossy fmtCost, a STATUS_LABELS map
// that StatusPill re-humanized into "Dao Finalized", and had no rowHref).

const columns: {
  key: keyof OrderRow;
  label: string;
  cellType?: "status" | "amount";
  align?: "right";
}[] = [
  { key: "workNumber", label: "Work No." },
  { key: "description", label: "Description" },
  { key: "status", label: "Status", cellType: "status" },
  { key: "category", label: "Category" },
  { key: "estimatedCost", label: "Est. Cost", cellType: "amount", align: "right" },
];

describe("mapOrders — GAP-WORKS-ORDERS-02 money is paise-exact (bigint-safe)", () => {
  it("keeps estimatedCostMinor as the raw paise string, never Number()", () => {
    const rows = mapOrders([
      { id: "a1", workNumber: "W1", status: "active", estimatedCostMinor: "865000050" },
    ])!;
    expect(rows[0].estimatedCost).toBe("865000050");
  });

  it("preserves precision above 2^53 paise (the old Number() path would corrupt this)", () => {
    const huge = "900719925474099300"; // > Number.MAX_SAFE_INTEGER paise
    const rows = mapOrders([{ id: "a1", status: "draft", estimatedCostMinor: huge }])!;
    expect(rows[0].estimatedCost).toBe(huge);
  });

  it("defaults a missing cost to '0' (a valid paise string for formatMoney)", () => {
    const rows = mapOrders([{ id: "a1", status: "draft" }])!;
    expect(rows[0].estimatedCost).toBe("0");
  });
});

describe("mapOrders — GAP-WORKS-ORDERS-03/05 raw status is passed through", () => {
  it("carries the raw backend status token, not a pre-humanized label", () => {
    const rows = mapOrders([{ id: "a1", status: "dao_finalized" }])!;
    expect(rows[0].status).toBe("dao_finalized");
  });

  it("sorts by lifecycle priority with unknown statuses last", () => {
    const rows = mapOrders([
      { id: "c", status: "closed" },
      { id: "u", status: "weird_state" },
      { id: "d", status: "draft" },
      { id: "t", status: "ts_eligible" },
    ])!;
    expect(rows.map((r) => r.id)).toEqual(["d", "t", "c", "u"]);
  });
});

describe("Work Orders table — GAP-WORKS-ORDERS-01/02/03 rendering", () => {
  const rows = mapOrders([
    { id: "p1", workNumber: "WRK/2026/001", description: "Culvert", status: "dao_finalized", category: "Regular", estimatedCostMinor: "865000050" },
    { id: "p2", workNumber: "WRK/2026/002", description: "Road", status: "ts_eligible", category: "Deposit", estimatedCostMinor: "12000000" },
  ])!;

  it("GAP-WORKS-ORDERS-01: each row links to its proposal detail page", () => {
    render(
      <DataTable<OrderRow>
        columns={columns}
        rows={rows}
        rowHref={(r) => `/works/proposals/${r.id}`}
      />,
    );
    const link = screen.getByRole("link", { name: /Open WRK\/2026\/001/i });
    expect(link).toHaveAttribute("href", "/works/proposals/p1");
  });

  it("GAP-WORKS-ORDERS-03: status renders as the acronym label, not 'Dao Finalized'", () => {
    render(<DataTable<OrderRow> columns={columns} rows={rows} />);
    expect(screen.getByText("DAO Finalized")).toBeInTheDocument();
    expect(screen.getByText("TS Eligible")).toBeInTheDocument();
    expect(screen.queryByText("Dao Finalized")).not.toBeInTheDocument();
    expect(screen.queryByText("Ts Eligible")).not.toBeInTheDocument();
  });

  it("GAP-WORKS-ORDERS-02: cost renders paise-exact (₹86,50,000.50), same as proposals", () => {
    render(<DataTable<OrderRow> columns={columns} rows={rows} />);
    expect(screen.getByText("₹86,50,000.50")).toBeInTheDocument();
  });
});
