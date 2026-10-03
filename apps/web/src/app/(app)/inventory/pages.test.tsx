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
  getInventoryGoodsReturns: vi.fn(),
  getInventoryLedger: vi.fn(),
  getInventoryLowStock: vi.fn(),
  getInventoryItemForecast: vi.fn(),
  getInventorySettings: vi.fn(),
}));
vi.mock("./_data", () => inv);

const lookups = vi.hoisted(() => ({
  getItemNames: vi.fn(),
  getStoreNames: vi.fn(),
  getWarehouseNames: vi.fn(),
}));
vi.mock("./_lookups", () => lookups);

const auth = vi.hoisted(() => ({
  getSessionRoles: vi.fn(() => ["inventory_manager"]),
  getSessionUserId: vi.fn(() => "approver-1"),
}));
// Keep the real role constants (no hand-copied literals); only the session readers are stubbed.
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

// Client leaves that need providers/ fetch are not under test here.
vi.mock("./cycle-counts/[id]/CycleCountActions", () => ({
  CycleCountActions: () => <button type="button">Approve</button>,
}));
vi.mock("./goods-returns/[id]/QcInspectionForm", () => ({ QcInspectionForm: () => <div>QC FORM</div> }));
vi.mock("../stock/_components/PrintExportButton", () => ({ PrintExportButton: () => null }));
vi.mock("./RegisterLinkCard", () => ({ RegisterLinkCard: () => <div>REGISTER LINK CARD</div> }));
const links = vi.hoisted(() => ({ getItemLinks: vi.fn(async () => ({ source: "api", data: [] })) }));
vi.mock("./_dataLinks", () => links);
vi.mock("./list/InventoryStockListClient", () => ({
  InventoryStockListClient: () => <div>STOCK REGISTER</div>,
}));
const forecastProps = vi.hoisted(() => ({ last: null as null | { itemName: string; totalDemand?: number; confidence?: number } }));
vi.mock("./MovementsTable", () => ({
  MovementsTable: (p: { kind: string }) => <div>MOVEMENTS {p.kind}</div>,
}));
vi.mock("./ForecastChart", () => ({
  ForecastChart: (p: { itemName: string; totalDemand?: number; confidence?: number }) => {
    forecastProps.last = p;
    return <div>FORECAST CHART</div>;
  },
}));

const { default: StockItemDetailPage } = await import("./[id]/page");
const { default: CycleCountDetailPage } = await import("./cycle-counts/[id]/page");
const { default: GoodsReturnDetailPage } = await import("./goods-returns/[id]/page");
const { default: InventoryListPage } = await import("./list/page");
const { default: InventoryReconcilePage } = await import("./reconcile/page");
const { default: InventoryReceiptsPage } = await import("./receipts/page");
const { default: InventoryHub } = await import("./page");
const { INVENTORY_WRITE_ROLES } = await import("@/lib/auth/roleGuard");

const params = { params: { id: "abc" } };
const retryBtn = () => screen.queryByRole("button", { name: /try again|retry/i });

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["inventory_manager"]);
  auth.getSessionUserId.mockReturnValue("approver-1");
  inv.getInventoryCycleCounts.mockResolvedValue({ data: [], source: "api" });
  inv.getInventoryGoodsReturns.mockResolvedValue({ data: [], source: "api" });
  inv.getInventorySettings.mockResolvedValue({ data: { qcMakerChecker: true }, source: "api" });
  lookups.getItemNames.mockResolvedValue(new Map());
  lookups.getStoreNames.mockResolvedValue(new Map());
  lookups.getWarehouseNames.mockResolvedValue(new Map());
  forecastProps.last = null;
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
    render(await InventoryReconcilePage({}));
    const net = screen.getByText("Net Movement (Qty)").closest(".stat");
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

const low = (itemId: string, name: string, onHandQty: number, reorderLevel: number) => ({
  itemId, name, sku: null, storeId: "s", onHandQty, reorderLevel, suggestedReorderQty: 1,
});

describe("GAP-INVENTORY-HOME-02 / -03 / -04", () => {
  it("charts the item furthest below its reorder level regardless of API order, and passes total + confidence", async () => {
    inv.getInventoryLowStock.mockResolvedValue({
      source: "api",
      data: [low("a", "Mild", 9, 10), low("b", "Severe", 2, 10), low("z", "NoLevel", 0, 0)],
    });
    inv.getInventoryItemForecast.mockResolvedValue({
      source: "api",
      data: { available: true, itemId: "b", dailyForecast: [1, 2], totalDemand: 42, confidence: 0.8 },
    });
    render(await InventoryHub());
    expect(inv.getInventoryItemForecast).toHaveBeenCalledWith("b");
    expect(forecastProps.last).toMatchObject({ itemName: "Severe", totalDemand: 42, confidence: 0.8 });
  });

  it("a full page of 200 pending returns reads 200+", async () => {
    inv.getInventoryLowStock.mockResolvedValue({ source: "api", data: [] });
    inv.getInventoryGoodsReturns.mockResolvedValue({
      source: "api",
      data: Array.from({ length: 200 }, () => ({ qcStatus: "pending" })),
    });
    render(await InventoryHub());
    expect(screen.getByText("200+ pending QC")).toBeInTheDocument();
  });

  it("tiles carry counts: low stock, pending QC and counts awaiting approval", async () => {
    inv.getInventoryLowStock.mockResolvedValue({ source: "api", data: [low("a", "A", 1, 5), low("b", "B", 1, 5)] });
    inv.getInventoryItemForecast.mockResolvedValue({ source: "api", data: { available: false, itemId: "a", dailyForecast: [], totalDemand: 0, confidence: 0 } });
    inv.getInventoryGoodsReturns.mockResolvedValue({
      source: "api",
      data: [{ qcStatus: "pending" }, { qcStatus: "passed" }, { qcStatus: "pending" }, { qcStatus: "pending" }],
    });
    inv.getInventoryCycleCounts.mockResolvedValue({ source: "api", data: [{ id: "1" }] });
    render(await InventoryHub());
    expect(screen.getByText("2 low")).toBeInTheDocument();
    expect(screen.getByText("3 pending QC")).toBeInTheDocument();
    expect(screen.getByText("1 counts to approve")).toBeInTheDocument();
  });

  it("a failed count fetch shows '—' on that tile only", async () => {
    inv.getInventoryLowStock.mockResolvedValue({ source: "api", data: [low("a", "A", 1, 5)] });
    inv.getInventoryItemForecast.mockResolvedValue({ source: "api", data: { available: false, itemId: "a", dailyForecast: [], totalDemand: 0, confidence: 0 } });
    inv.getInventoryGoodsReturns.mockResolvedValue({ source: "error", data: [] });
    render(await InventoryHub());
    expect(screen.getByText("1 low")).toBeInTheDocument();
    expect(screen.queryByText(/pending QC/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("GAP-INVENTORY-LIST-03: pending cycle counts", () => {
  const stock = { source: "api", data: [{ id: "1", itemCode: "A", name: "A", category: "c", unit: "u", currentStock: 1, minStockLevel: 1, totalValue: 100, isLowStock: false }] };

  it("a failed cycle-count fetch shows its own retry notice instead of hiding approvals", async () => {
    loaders.getStockItems.mockResolvedValue(stock);
    inv.getInventoryCycleCounts.mockResolvedValue({ data: [], source: "error" });
    render(await InventoryListPage());
    expect(screen.getByText(/pending cycle-count approvals/i)).toBeInTheDocument();
    expect(retryBtn()).toBeInTheDocument();
  });

  it("rows show item and warehouse names, never the raw ids", async () => {
    loaders.getStockItems.mockResolvedValue(stock);
    inv.getInventoryCycleCounts.mockResolvedValue({
      source: "api",
      data: [{
        id: "cc-1", itemId: "11111111-2222-3333-4444-555555555555", warehouseId: "99999999-8888-7777-6666-555555555555",
        itemName: "Toner", itemSku: "T-1", warehouseName: "Main Store", systemQty: 1, physicalQty: 2, variance: 1,
        absVariance: 1, status: "pending_approval", reasonCode: "recount", countedAt: "2026-08-01", createdAt: "2026-08-01",
      }],
    });
    render(await InventoryListPage());
    expect(screen.getByText("T-1 · Toner")).toBeInTheDocument();
    expect(screen.getByText("Main Store")).toBeInTheDocument();
    expect(screen.queryByText(/11111111-2222/)).not.toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-CYCLE-COUNTS-DETAIL-03 / -05", () => {
  const base = {
    id: "abc", itemId: "i-1", warehouseId: "w-1", systemQty: 10, physicalQty: 12, variance: 2, absVariance: 2,
    autoAdjustThreshold: 10, reasonCode: "recount", status: "approved", countedAt: "2026-08-01", createdAt: "2026-08-01",
    version: 3, approvedBy: "u-1234567890", adjustmentId: "adj-0001",
  };

  it("shows item and warehouse names (no UUID text) and the adjustment reference when approved", async () => {
    loaders.getCycleCountById.mockResolvedValue({ source: "api", data: base });
    lookups.getItemNames.mockResolvedValue(new Map([["i-1", { name: "Toner", sku: "T-1" }]]));
    lookups.getWarehouseNames.mockResolvedValue(new Map([["w-1", "Main Store"]]));
    render(await CycleCountDetailPage(params));
    expect(screen.getAllByText("T-1 · Toner").length).toBeGreaterThan(0);
    expect(screen.getByText("Main Store")).toBeInTheDocument();
    expect(screen.queryByText("i-1")).not.toBeInTheDocument();
    // GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05: a real link to the movement detail, never the raw id as text
    const link = screen.getByRole("link", { name: "View stock adjustment" });
    expect(link).toHaveAttribute("href", "/inventory/movements/adj-0001");
    expect(screen.queryByText("adj-0001")).not.toBeInTheDocument();
  });

  it("names the approver when the service resolved the name, else 'User <id prefix>'", async () => {
    loaders.getCycleCountById.mockResolvedValue({ source: "api", data: { ...base, approvedByName: "Vikram Sethi" } });
    render(await CycleCountDetailPage(params));
    expect(screen.getByText("Vikram Sethi")).toBeInTheDocument();
    expect(screen.queryByText(/User u-123456/)).not.toBeInTheDocument();
  });

  it("falls back to 'User <id prefix>' when no name was resolved", async () => {
    loaders.getCycleCountById.mockResolvedValue({ source: "api", data: base });
    render(await CycleCountDetailPage(params));
    expect(screen.getByText("User u-123456")).toBeInTheDocument();
  });

  it("an unresolvable warehouse reads '—' and a rejected count shows no adjustment reference", async () => {
    loaders.getCycleCountById.mockResolvedValue({ source: "api", data: { ...base, status: "rejected", rejectedBy: "u-2" } });
    render(await CycleCountDetailPage(params));
    expect(screen.queryByRole("link", { name: "View stock adjustment" })).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("GAP-INVENTORY-GOODS-RETURNS-DETAIL-05: names and disposition wording", () => {
  it("shows item and store names and the truthful disposition label", async () => {
    loaders.getGoodsReturnById.mockResolvedValue({
      source: "api",
      data: {
        id: "gr-1", originalIssueId: "iss-1", itemId: "i-1", storeId: "s-1", qty: 3, reason: "damaged",
        qcStatus: "failed", qcInspectedBy: "u-1234567890", qcInspectedAt: "2026-08-02", qcNotes: "water",
        disposition: "quarantine", createdAt: "2026-08-01",
      },
    });
    lookups.getItemNames.mockResolvedValue(new Map([["i-1", { name: "Toner", sku: "T-1" }]]));
    lookups.getStoreNames.mockResolvedValue(new Map([["s-1", "Central Store"]]));
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText("T-1 · Toner")).toBeInTheDocument();
    expect(screen.getByText("Central Store")).toBeInTheDocument();
    expect(screen.getByText("Quarantine")).toBeInTheDocument();
    expect(screen.queryByText(/penalty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GRN reference/i)).not.toBeInTheDocument();
  });
});

describe("GAP-INVENTORY-GOODS-RETURNS-DETAIL-04 / -05: maker != checker and inspector names", () => {
  const pending = {
    id: "gr-1", originalIssueId: "iss-1", itemId: "i-1", storeId: "s-1", qty: 3, reason: "damaged",
    qcStatus: "pending", qcInspectedBy: null, qcInspectedAt: null, qcNotes: null,
    disposition: "pending", createdAt: "2026-08-01", createdBy: "maker-1", createdByName: "Asha Rao",
  };

  it("the person who recorded the return does not get the QC form, and is told why", async () => {
    auth.getSessionUserId.mockReturnValue("maker-1");
    loaders.getGoodsReturnById.mockResolvedValue({ source: "api", data: pending });
    render(await GoodsReturnDetailPage(params));
    expect(screen.queryByText("QC FORM")).not.toBeInTheDocument();
    expect(screen.getByText(/a different person must record its QC verdict/i)).toBeInTheDocument();
  });

  it("a different user gets the QC form", async () => {
    auth.getSessionUserId.mockReturnValue("checker-1");
    loaders.getGoodsReturnById.mockResolvedValue({ source: "api", data: pending });
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText("QC FORM")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  it("when the tenant turned maker-checker off the creator gets the form", async () => {
    auth.getSessionUserId.mockReturnValue("maker-1");
    inv.getInventorySettings.mockResolvedValue({ data: { qcMakerChecker: false }, source: "api" });
    loaders.getGoodsReturnById.mockResolvedValue({ source: "api", data: pending });
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText("QC FORM")).toBeInTheDocument();
  });

  it("shows the inspector by name once decided", async () => {
    loaders.getGoodsReturnById.mockResolvedValue({
      source: "api",
      data: { ...pending, qcStatus: "passed", disposition: "restock", qcInspectedBy: "checker-1", qcInspectedByName: "Vikram Sethi", qcInspectedAt: "2026-08-02" },
    });
    render(await GoodsReturnDetailPage(params));
    expect(screen.getByText("Vikram Sethi")).toBeInTheDocument();
    expect(screen.queryByText(/User checker-1/)).not.toBeInTheDocument();
  });
});

describe("INVENTORY_WRITE_ROLES stays in step with the service", () => {
  it("includes the roles the service WRITE_ROLES allow for bins and items", () => {
    for (const r of ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"]) {
      expect(INVENTORY_WRITE_ROLES).toContain(r);
    }
  });
});

describe("receipts register asks the service for receipts only (GAP-INVENTORY-RECEIPTS-02 alignment)", () => {
  it("calls getInventoryLedger with movementType receipt", async () => {
    inv.getInventoryLedger.mockResolvedValue({ data: [], source: "api" });
    render(await InventoryReceiptsPage());
    expect(inv.getInventoryLedger).toHaveBeenCalledWith({ movementType: "receipt" });
    expect(screen.getByText("MOVEMENTS receipt")).toBeInTheDocument();
  });
});

describe("unknown stock levels are not Low Stock and not Rs 0 (stock-service reports none)", () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    id, itemCode: id, name: id, category: "c", unit: "u", currentStock: 5, minStockLevel: 1,
    unitCost: 100, totalValue: 500, isLowStock: false, ...over,
  });

  it("excludes unreported items from the low-stock count and the value total, and says so", async () => {
    loaders.getStockItems.mockResolvedValue({
      source: "api",
      data: [
        item("A", { isLowStock: true, currentStock: 0, totalValue: 12500 }),
        item("B"),
        item("U", { currentStock: null, unitCost: null, totalValue: null, isLowStock: null }),
      ],
    });
    const { container } = render(await InventoryListPage());
    const stats = Array.from(container.querySelectorAll(".stat")).map((e) => e.textContent ?? "");
    expect(stats.join(" ")).toContain("2 of 3 items valued");
    expect(stats.join(" ")).toContain("₹130.00"); // 12500 + 500 paise, U excluded
    const low = stats.find((s) => s.includes("Low Stock"));
    expect(low).toMatch(/1/);
  });

  it("when no item reports a value the value stat is a dash, not Rs 0", async () => {
    loaders.getStockItems.mockResolvedValue({
      source: "api",
      data: [item("U", { currentStock: null, unitCost: null, totalValue: null, isLowStock: null })],
    });
    const { container } = render(await InventoryListPage());
    const value = Array.from(container.querySelectorAll(".stat")).find((e) => (e.textContent ?? "").includes("Stock Value"));
    expect(value?.textContent).toContain("—");
    expect(value?.textContent).not.toContain("₹0");
  });
});
