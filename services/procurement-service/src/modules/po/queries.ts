import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PoRow } from "./schema.js";

export async function getPo(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const po = await cache.getOrLoad<PoRow | null>(
    cache.makeKey(tenantId, "po", id),
    () => repo.findPoById(id),
  );
  if (!po || po.tenantId !== tenantId) return null;

  const { listVendorsByTenant } = await import("../vendor/repo.js");
  const vendors = await listVendorsByTenant(tenantId, 500);
  const vendorName = vendors.find((v) => v.id === po.vendorId)?.name ?? po.vendorId.slice(0, 8);
  const items = await repo.findPoItemsByPoId(id);

  const orderDate =
    po.createdAt instanceof Date
      ? po.createdAt.toISOString().slice(0, 10)
      : String(po.createdAt ?? "").slice(0, 10) || "—";

  return {
    ...po,
    totalMinor: String(po.totalMinor),
    vendor: vendorName,
    vendorName,
    orderDate,
    deliveryDate: po.deliveryDate ? String(po.deliveryDate).slice(0, 10) : undefined,
    totalAmount: Number(po.totalMinor),
    lineItems: items.map((i) => ({
      itemCode: i.itemCode,
      itemName: i.description,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceMinor: Number(i.unitPriceMinor),
      unitPrice: Number(i.unitPriceMinor),
      totalPrice: Number(i.unitPriceMinor) * i.quantity,
      grnQty: 0,
    })),
  };
}

export async function listPos(tenantId: string, limit: number, offset = 0): Promise<{ data: Array<{ id: string; poNo: string; vendor: string; amountDisplay: string; totalMinor: string; orderDate: string; deliveryDate?: string | null; status: string }> }> {
  const rows = await repo.listPosByTenant(tenantId, limit, offset);
  const { listVendorsByTenant } = await import("../vendor/repo.js");
  const vendors = await listVendorsByTenant(tenantId, 500);
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  return {
    data: rows.map((r) => ({
      id: r.id,
      poNo: r.poNo,
      vendor: vendorNameById.get(r.vendorId) ?? r.vendorId.slice(0, 8),
      amountDisplay: `₹${(Number(r.totalMinor) / 100).toLocaleString("en-IN")}`,
      totalMinor: String(r.totalMinor),
      orderDate: r.createdAt instanceof Date
        ? r.createdAt.toISOString().slice(0, 10)
        : String(r.createdAt ?? "").slice(0, 10) || "—",
      deliveryDate: r.deliveryDate ? String(r.deliveryDate).slice(0, 10) : null,
      status: r.status,
    })),
  };
}
