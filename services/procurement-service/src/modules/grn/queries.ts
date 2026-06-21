import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { GrnRow } from "./schema.js";

export async function getGrn(id: string, tenantId: string): Promise<GrnRow | null> {
  return cache.getOrLoad<GrnRow>(
    cache.makeKey(tenantId, "grn", id),
    () => repo.findGrnById(id)
  );
}

export async function listGrns(tenantId: string, limit: number, offset: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grns", `list:${limit}:${offset}`),
    () => repo.listGrnsByTenant(tenantId, limit, offset),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    grnNo: row.grnNo,
    poRef: row.poRef,
    vendor: row.vendorId,
    receivedDate: String(row.receivedDate),
    receivedBy: row.createdBy,
    itemCount: 0,
    totalValue: 0,
    status: mapGrnStatus(row.status),
  }));
}

function mapGrnStatus(status: string): "draft" | "received" | "quality_check" | "accepted" | "partially_rejected" | "rejected" {
  const valid = ["draft", "received", "quality_check", "accepted", "partially_rejected", "rejected"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}
