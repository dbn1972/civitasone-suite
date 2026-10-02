import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({
  getStockItemById: vi.fn(),
  getCycleCountById: vi.fn(),
  getGoodsReturnById: vi.fn(),
  getStockItems: vi.fn(),
  getStockLedger: vi.fn(),
}));
vi.mock("@/app/_data/loaders", () => loaders);

const inv = vi.hoisted(() => ({
  getInventoryCycleCounts: vi.fn(),
  getInventoryLowStock: vi.fn(),
  getInventoryItemForecast: vi.fn(),
}));
vi.mock("./_data", () => inv);

const auth = vi.hoisted(() => ({
  getSessionRoles: vi.fn(() => ["inventory_manager"]),
  getSessionUserId: vi.fn(() => "approver-1"),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  ...auth,
  INVENTORY_CYCLE_COUNT_APPROVE_ROLES: ["inventory_manager", "inventory_admin", "super_admin"],
}));

// Client leaves that need providers/ fetch are not under test here.
vi.mock("./cycle-counts/[id]/CycleCountActions", () => ({
  CycleCountActions: () => <button type="button">Approve</button>,
}));
vi.mock("./goods-returns/[id]/QcInspectionForm", () => ({ QcInspectionForm: () => null }));
vi.mock("../stock/_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("./list/InventoryStockListClient", () => ({
  InventoryStockListClient: () => <div>STOCK REGISTER</div>,
}));
vi.mock("./ForecastChart", () => ({ ForecastChart: () => <div>FORECAST CHART</div> }));

const { default: StockItemDetailPage } = await import("./[id]/page");
const { default: CycleCountDetailPage } = await import("./cycle-counts/[id]/page");
const { default: GoodsReturnDetailPage } = await import("./goods-returns/[id]/page");
const { default: InventoryListPage } = await import("./list/page");
const { default: InventoryReconcilePage } = await import("./reconcile/page");
const { default: InventoryHub } = await import("./page");

const params = { params: { id: "abc" } };
const retryBtn = () => screen.queryByRole("button", { name: /try again|retry/i });

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["inventory_manager"]);
  auth.getSessionUserId.mockReturnValue("approver-1");
  inv.getInventoryCycleCounts.mockResolvedValue({ data: [], source: "api" });
});

describe("GAP-INVENTORY-DETAIL-01: stock item detail separates outage from 404", () => {
  it("503 shows a retry state, not 'Item not found'", async () => {
    loaders.getStockItemById.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await StockItemDetailPage(params));
    expect(screen.queryByText(/item not found/i)).not.toBeInTheDocument();
    expect(retryBtn()).toBeInTheDocument();
  });

  it("404 shows 'Item not found'", async () => {
    loaders.getStockItemById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await StockItemDetailPage(params));
    expect(screen.getByText(/item not found/i)).toBeInTheDocument();
  });

  it("an ok item renders and its Stock Entry link targets the real /inventory/ledger/new route (GAP-INVENTORY-DETAIL-02)", async () => {
    loaders.getStockItemById.mockResolvedValue({
      source: "api",
      data: {
        id: "abc", itemCode: "IT-1", name: "Paper", category: "Stationery", unit: "ream",
        currentStock: 5, minStockLevel: 2, unitCost: 10000, totalValue: 50000, isLowStock: false,
        stockLedger: [
          { id: "1", date: "2026-08-01", type: "adjustment", direction: "out", signedQuantity: -5, quantity: 5, balance: 10 },
          { id: "2", date: "2026-08-02", type: "transfer", direction: "in", signedQuantity: 3, quantity: 3, balance: 13 },
        ],
      },
    });
    render(await StockItemDetailPage(params));
    const link = screen.getByRole("link", { name: /\+ Stock Entry/ });
    expect(link).toHaveAttribute("href", "/inventory/ledger/new?itemId=abc");
    // GAP-INVENTORY-DETAIL-03: sign follows direction, not type === "issue"
    expect(screen.getByText("-5")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-CYCLE-COUNTS-DETAIL-01 / -02", () => {
  const cc = (over: Record<string, unknown> = {}) => ({
    source: "api",
    data: {
      id: "abc", itemId: "i", warehouseId: "w", systemQty: 10, physicalQty: 50, variance: 40, absVariance: 40,
      autoAdjustThreshold: 10, reasonCode: "recount", status: "pending_approval", countedAt: "2026-08-01",
      createdAt: "2026-08-01", version: 3, createdBy: "counter-9", ...over,
    },
  });

  it("503 shows a retry state, not 'Cycle count not found'", async () => {
    loaders.getCycleCountById.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await CycleCountDetailPage(params));
    expect(screen.queryByText(/cycle count not found/i)).not.toBeInTheDocument();
    expect(retryBtn()).toBeInTheDocument();
  });

  it("404 shows 'Cycle count not found'", async () => {
    loaders.getCycleCountById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await CycleCountDetailPage(params));
    expect(screen.getByText(/cycle count not found/i)).toBeInTheDocument();
  });

  it("an approver who is not the maker sees Approve", async () => {
    loaders.getCycleCountById.mockResolvedValue(cc());
    render(await CycleCountDetailPage(params));
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("the maker does not get Approve and is told why", async () => {
    auth.getSessionUserId.mockReturnValue("counter-9");
    loaders.getCycleCountById.mockResolvedValue(cc());
    render(await CycleCountDetailPage(params));
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText(/different approver/i)).toBeInTheDocument();
  });

  it("a non-approver role does not get Approve", async () => {
    auth.getSessionRoles.mockReturnValue(["store_keeper"]);
    loaders.getCycleCountById.mockResolvedValue(cc());
    render(await CycleCountDetailPage(params));
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-GOODS-RETURNS-DETAIL-03", () => {
  it("500 shows a retry state, not 'Goods return not found'", async () => {
    loaders.getGoodsReturnById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await GoodsReturnDetailPage(params));
    expect(screen.queryByText(/goods return not found/i)).not.toBeInTheDocument();
    expect(retryBtn()).toBeInTheDocument();
  });

  it("403 shows a permission-denied state", async () => {
    loaders.getGoodsReturnById.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText(/goods return not found/i)).not.toBeInTheDocument();
  });

  it("404 shows 'Goods return not found'", async () => {
    loaders.getGoodsReturnById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText(/goods return not found/i)).toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-LIST-01", () => {
  it("failed fetch: no zero stats, no 'Add stock items' copy, retry visible", async () => {
    loaders.getStockItems.mockResolvedValue({ data: [], source: "error", status: 500 });
    const { container } = render(await InventoryListPage());
    expect(retryBtn()).toBeInTheDocument();
    expect(screen.queryByText("STOCK REGISTER")).not.toBeInTheDocument();
    expect(screen.queryByText(/add stock items/i)).not.toBeInTheDocument();
    for (const el of Array.from(container.querySelectorAll(".stat"))) expect(el.textContent).toContain("—");
  });

  it("healthy fetch renders the register and real counts", async () => {
    loaders.getStockItems.mockResolvedValue({
      source: "api",
      data: [{ id: "1", itemCode: "A", name: "A", category: "c", unit: "u", currentStock: 1, minStockLevel: 1, totalValue: 100, isLowStock: true }],
    });
    render(await InventoryListPage());
    expect(screen.getByText("STOCK REGISTER")).toBeInTheDocument();
    expect(retryBtn()).not.toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-RECONCILE-02: Net uses signed quantities", () => {
  const e = (id: string, type: string, quantity: number, direction: "in" | "out") => ({
    id, itemCode: "X", itemName: "X", date: "2026-08-01", type, quantity, direction,
    signedQuantity: direction === "out" ? -quantity : quantity, unitCost: 0, totalValue: 0, balance: 0,
  });

  it("receipts 10, issues 3, adjustment -2 => Net 5; an unclassified row is counted in Net and shown as its own stat", async () => {
    loaders.getStockLedger.mockResolvedValue({
      source: "api",
      data: [e("1", "receipt", 10, "in"), e("2", "issue", 3, "out"), e("3", "adjustment", 2, "out"), e("4", "other", 99, "in")],
    });
    render(await InventoryReconcilePage());
    const net = screen.getByText("Net Balance (Qty)").closest(".stat");
    expect(net?.textContent).toContain("104"); // 10 - 3 - 2 + 99: Net = sum of signedQuantity over ALL rows
    expect(screen.getByText("Unclassified rows").closest(".stat")?.textContent).toContain("1");
    const out = screen.getByText("Total Out (Qty)").closest(".stat");
    expect(out?.textContent).toContain("3");
  });
});

describe("GAP-INVENTORY-HOME-01", () => {
  it("low-stock outage shows a retry card and '—' (not a healthy empty hub)", async () => {
    inv.getInventoryLowStock.mockResolvedValue({ data: [], source: "error" });
    const { container } = render(await InventoryHub());
    expect(retryBtn()).toBeInTheDocument();
    expect(container.querySelector(".stat")?.textContent).toContain("—");
    expect(inv.getInventoryItemForecast).not.toHaveBeenCalled();
  });

  it("forecast outage with healthy low-stock keeps the count and notes the forecast", async () => {
    inv.getInventoryLowStock.mockResolvedValue({
      source: "api",
      data: [{ itemId: "i1", sku: "S", name: "Pen", onHandQty: 1, reorderLevel: 5, suggestedReorderQty: 4 }],
    });
    inv.getInventoryItemForecast.mockResolvedValue({
      data: { available: false, itemId: "i1", dailyForecast: [], totalDemand: 0, confidence: 0 },
      source: "error",
    });
    const { container } = render(await InventoryHub());
    expect(retryBtn()).not.toBeInTheDocument();
    expect(container.querySelector(".stat")?.textContent).toContain("1");
    expect(screen.getByText(/forecast unavailable/i)).toBeInTheDocument();
  });
});
