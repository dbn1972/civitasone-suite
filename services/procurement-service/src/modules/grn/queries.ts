import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as vendorRepo from "../vendor/repo.js";
import type { GrnRow } from "./schema.js";

export async function getGrn(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const row = await cache.getOrLoad<GrnRow | null>(
    cache.makeKey(tenantId, "grn", id),
    () => repo.findGrnById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;

  const items = await repo.findGrnItemsByGrnId(id);
  const inspection = await repo.findInspectionByGrnId(id);
  const vendor = await vendorRepo.findVendorById(row.vendorId, tenantId);

  return {
    id: row.id,
    grnNo: row.grnNo,
    poRef: row.poRef,
    vendor: vendor?.name ?? row.vendorId.slice(0, 8),
    vendorId: row.vendorId,
    receivedDate: String(row.receivedDate),
    receivedBy: row.createdBy,
    threeWayMatch: row.threeWayMatch,
    notes: row.notes ?? undefined,
    itemCount: items.length,
    totalValue: 0,
    status: mapGrnStatus(row.status),
    items: items.map((i) => ({
      id: i.id,
      poItemRef: i.poItemRef,
      itemCode: i.itemCode,
      orderedQty: i.orderedQty,
      receivedQty: i.receivedQty,
      acceptedQty: i.acceptedQty,
      unit: i.unit,
    })),
    inspection: inspection
      ? {
          inspectorId: inspection.inspectorId,
          inspectionDate: String(inspection.inspectionDate),
          result: inspection.result,
          remarks: inspection.remarks ?? undefined,
        }
      : null,
  };
}

export async function listGrns(tenantId: string, limit: number, offset: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grns", `list:${limit}:${offset}`),
    () => repo.listGrnsByTenant(tenantId, limit, offset),
    60,
  );
  const grnRows = rows ?? [];
  const vendors = await vendorRepo.listVendorsByTenant(tenantId, 500);
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  const itemCounts = await Promise.all(
    grnRows.map(async (row) => {
      const items = await repo.findGrnItemsByGrnId(row.id);
      return [row.id, items.length] as const;
    }),
  );
  const countById = new Map(itemCounts);

  return grnRows.map((row) => ({
    id: row.id,
    grnNo: row.grnNo,
    poRef: row.poRef,
    vendor: vendorNameById.get(row.vendorId) ?? row.vendorId.slice(0, 8),
    receivedDate: String(row.receivedDate),
    receivedBy: row.createdBy,
    itemCount: countById.get(row.id) ?? 0,
    totalValue: 0,
    status: mapGrnStatus(row.status),
    threeWayMatch: row.threeWayMatch,
  }));
}

function mapGrnStatus(status: string): "draft" | "under_inspection" | "received" | "quality_check" | "accepted" | "partially_rejected" | "rejected" {
  const valid = ["draft", "under_inspection", "received", "quality_check", "accepted", "partially_rejected", "rejected"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}
