import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { PoRow } from "./schema.js";

const PO_REF_UUID = /^(?:procurement_po:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * D4c #25 (GAP-PROCUREMENT-CONTRACTS-NEW-06): resolve a PO reference as a
 * contract quotes it - a PO uuid, the composite `procurement_po:<uuid>`, or the
 * PO number (exact match) - to the real, tenant-scoped PO. null = no such PO.
 */
export async function resolvePoRef(tenantId: string, ref: string): Promise<{ id: string; poNo: string; status: string } | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const m = PO_REF_UUID.exec(trimmed);
  const po = m ? await repo.findPoById(m[1]!.toLowerCase(), tenantId) : await repo.findPoByNo(trimmed, tenantId);
  return po ? { id: po.id, poNo: po.poNo, status: po.status } : null;
}

export async function getPo(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const po = await cache.getOrLoad<PoRow | null>(
    cache.makeKey(tenantId, "po", id),
    () => repo.findPoById(id, tenantId),
  );
  if (!po || po.tenantId !== tenantId) return null;

  const { listVendorsByTenant } = await import("../vendor/repo.js");
  const vendors = await listVendorsByTenant(tenantId, 500);
  const vendorName = vendors.find((v) => v.id === po.vendorId)?.name ?? po.vendorId.slice(0, 8);
  const items = await repo.findPoItemsByPoId(id, tenantId);

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

export async function listPos(tenantId: string, limit: number, offset = 0, q?: string, vendorId?: string): Promise<{ data: Array<{ id: string; poNo: string; vendor: string; amountDisplay: string; totalMinor: string; orderDate: string; deliveryDate?: string | null; status: string }> }> {
  const rows = await repo.listPosByTenant(tenantId, limit, offset, q, vendorId);
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
