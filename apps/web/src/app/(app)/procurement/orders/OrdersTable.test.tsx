import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Drive the component's own stats/filter/label logic, not the offline-cache
// layer. The mock returns whatever provenance+data the test sets.
let mockData: unknown[] = [];
let mockProvenance: "live" | "cached" | "error-no-data" = "live";
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: () => ({
    data: mockData,
    fromCache: mockProvenance === "cached",
    offline: false,
    cachedAt: null,
    provenance: mockProvenance,
  }),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// todayIST is used for the overdue comparison — pin it so the test is stable.
vi.mock("@/lib/formatters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formatters")>();
  return { ...actual, todayIST: () => "2026-06-15" };
});

import { OrdersTable } from "./OrdersTable";

const LAKH = 10_000_000; // ₹1,00,000 in paise

function order(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? "11111111-1111-1111-1111-111111111111",
    poNo: over.poNo ?? "PO/2026/0001",
    vendor: over.vendor ?? "Acme Supplies",
    amount: over.amount ?? LAKH,
    orderDate: over.orderDate ?? "2026-06-01",
    deliveryDate: over.deliveryDate ?? null,
    grnStatus: over.grnStatus ?? null,
    status: over.status ?? "approved",
    ...over,
  };
}

describe("OrdersTable — error provenance (GAP-PROCUREMENT-ORDERS-01)", () => {
  beforeEach(() => { mockData = []; mockProvenance = "live"; refreshMock.mockReset(); });

  it("error-no-data shows stats as '—' and an error state, not 'No purchase orders found'", () => {
    mockData = [];
    mockProvenance = "error-no-data";
    render(<OrdersTable orders={[]} source="error" />);

    // Stats read "—" (not a fabricated 0 / ₹0.00).
    expect(screen.queryByText("No purchase orders found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    // An actual retry affordance is present.
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    // No fabricated zero value anywhere in the stat grid.
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });
});

describe("OrdersTable — committed value (GAP-PROCUREMENT-ORDERS-02)", () => {
  beforeEach(() => { mockData = []; mockProvenance = "live"; });

  it("excludes a cancelled ₹1,00,000 PO from Committed value", () => {
    mockData = [
      order({ id: "a", status: "approved", amount: LAKH }),
      order({ id: "b", status: "cancelled", amount: LAKH }),
      order({ id: "c", status: "draft", amount: LAKH }),
    ];
    render(<OrdersTable orders={mockData as never} source="api" />);
    // Only the approved PO (₹1,00,000) is committed, not the cancelled/draft ones.
    const committedLabel = screen.getByText("Committed value");
    const card = committedLabel.closest(".stat") as HTMLElement;
    expect(within(card).getByText("₹1,00,000.00")).toBeInTheDocument();
    // Would be ₹3,00,000.00 if draft/cancelled were wrongly included.
    expect(within(card).queryByText("₹3,00,000.00")).not.toBeInTheDocument();
  });
});

describe("OrdersTable — status chips (GAP-PROCUREMENT-ORDERS-04)", () => {
  beforeEach(() => { mockData = []; mockProvenance = "live"; });

  it("clicking a status chip filters the rows to that status", () => {
    mockData = [
      order({ id: "a", poNo: "PO/2026/0001", status: "approved" }),
      order({ id: "b", poNo: "PO/2026/0002", status: "pending" }),
    ];
    render(<OrdersTable orders={mockData as never} source="api" />);

    // Both rows visible under "All".
    expect(screen.getByText("PO/2026/0001")).toBeInTheDocument();
    expect(screen.getByText("PO/2026/0002")).toBeInTheDocument();

    // Click the "Pending Approval (1)" chip.
    fireEvent.click(screen.getByRole("tab", { name: /Pending Approval \(1\)/ }));

    expect(screen.queryByText("PO/2026/0001")).not.toBeInTheDocument();
    expect(screen.getByText("PO/2026/0002")).toBeInTheDocument();
  });
});

describe("OrdersTable — GRN labels + overdue (GAP-PROCUREMENT-ORDERS-05)", () => {
  beforeEach(() => { mockData = []; mockProvenance = "live"; });

  it("renders a labelled GRN status ('partial' -> 'Partially received')", () => {
    mockData = [order({ grnStatus: "partial" })];
    render(<OrdersTable orders={mockData as never} source="api" />);
    expect(screen.getByText("Partially received")).toBeInTheDocument();
  });

  it("flags an overdue delivery on a dispatched PO", () => {
    mockData = [order({ status: "dispatched", deliveryDate: "2026-06-01" })];
    render(<OrdersTable orders={mockData as never} source="api" />);
    // today is pinned to 2026-06-15, so a 2026-06-01 delivery on a dispatched PO is overdue.
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it("does NOT flag overdue once fully received", () => {
    mockData = [order({ status: "fully_received", deliveryDate: "2026-06-01" })];
    render(<OrdersTable orders={mockData as never} source="api" />);
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("renders 'GeM Placed' (shared label map) for a gem_placed PO", () => {
    mockData = [order({ status: "gem_placed" })];
    render(<OrdersTable orders={mockData as never} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("GeM Placed")).toBeInTheDocument();
  });
});
