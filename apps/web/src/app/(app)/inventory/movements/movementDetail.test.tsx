import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const inv = vi.hoisted(() => ({ getInventoryMovementById: vi.fn() }));
vi.mock("../_data", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_data")>()), ...inv }));

const { default: MovementDetailPage } = await import("./[id]/page");
const { mapMovementDetail } = await import("../_data");

const movement = {
  id: "m-1", movementType: "adjustment", postingDate: "2026-08-01", refDoc: null, refNo: null, grnNo: null, poRef: null,
  reasonCode: "COUNT", notes: null, status: "posted", fromStoreId: null, toStoreId: "s-1", createdBy: "u-1",
  createdByName: "Asha Rao", createdAt: "2026-08-01T00:00:00Z", toStoreName: "Central Store",
  lines: [{ id: "l-1", itemId: "i-1", qty: -3, rateMinor: "1200", amountMinor: "-3600", itemName: "Toner", itemSku: "T-1" }],
};

beforeEach(() => vi.clearAllMocks());

describe("movement detail (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-05)", () => {
  it("shows the movement, its lines by item name, the store name and the poster by name", async () => {
    inv.getInventoryMovementById.mockResolvedValue({ source: "api", data: movement });
    render(await MovementDetailPage({ params: { id: "m-1" } }));
    expect(screen.getByRole("heading", { name: /Stock adjustment/ })).toBeInTheDocument();
    expect(screen.getByText("T-1 · Toner")).toBeInTheDocument();
    expect(screen.getByText("Central Store")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("i-1")).not.toBeInTheDocument();
  });

  it("a real 404 reads 'not found'; an outage reads as a load error, not 'not found'", async () => {
    inv.getInventoryMovementById.mockResolvedValue({ source: "error", status: 404, data: null });
    const { unmount } = render(await MovementDetailPage({ params: { id: "x" } }));
    expect(screen.getByText(/Stock movement not found/)).toBeInTheDocument();
    unmount();
    inv.getInventoryMovementById.mockResolvedValue({ source: "error", status: 503, data: null });
    render(await MovementDetailPage({ params: { id: "x" } }));
    expect(screen.queryByText(/Stock movement not found/)).not.toBeInTheDocument();
  });
});

describe("mapMovementDetail", () => {
  it("maps header and lines, dropping malformed lines", () => {
    const m = mapMovementDetail({ data: { id: "m-1", movementType: "receipt", grnNo: "G-1", lines: [{ id: "l", itemId: "i", qty: 2, rateMinor: "5", amountMinor: "10" }, { qty: 1 }] } });
    expect(m).toMatchObject({ id: "m-1", grnNo: "G-1" });
    expect(m!.lines).toHaveLength(1);
  });
  it("returns null without an id", () => {
    expect(mapMovementDetail({ data: {} })).toBeNull();
    expect(mapMovementDetail(null)).toBeNull();
  });
});
