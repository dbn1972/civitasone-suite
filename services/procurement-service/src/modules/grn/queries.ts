import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as vendorRepo from "../vendor/repo.js";
import * as poRepo from "../po/repo.js";
import type { GrnRow } from "./schema.js";

/**
 * GAP2-PROCUREMENT-GRN-DETAIL-06 — GRN rows carry the cross-domain PO reference
 * as the opaque composite `procurement_po:<uuid>` (house rule 13). Extract the
 * bare PO uuid so callers can resolve it to a human PO number; null for a
 * missing/placeholder ref.
 */
function poIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const PREFIX = "procurement_po:";
  const id = ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : ref;
  return id && id !== "undefined" ? id : null;
}

export async function getGrn(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const row = await cache.getOrLoad<GrnRow | null>(
    cache.makeKey(tenantId, "grn", id),
    () => repo.findGrnById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;

  const items = await repo.findGrnItemsByGrnId(id);
  const inspection = await repo.findInspectionByGrnId(id);
  const vendor = await vendorRepo.findVendorById(row.vendorId, tenantId);

  // GAP2-PROCUREMENT-GRN-DETAIL-06 — resolve the opaque poRef to its human PO
  // number so the web detail can render a readable link instead of the raw
  // `procurement_po:<uuid>` composite. poId is still exposed for the link href.
  const poId = poIdFromRef(row.poRef);
  const po = poId ? await poRepo.findPoById(poId, tenantId) : null;

  return {
    id: row.id,
    grnNo: row.grnNo,
    poRef: row.poRef,
    poId: poId ?? undefined,
    poNo: po?.poNo ?? undefined,
    vendor: vendor?.name ?? row.vendorId.slice(0, 8),
    vendorId: row.vendorId,
    receivedDate: String(row.receivedDate),
    receivedBy: row.createdBy,
    // GAP-PROCUREMENT-GRN-DETAIL-03 — expose the creator id so the web detail
    // page can pre-empt a self-inspection (SoD) block up front. The server
    // remains authoritative (acceptGrn/rejectGrn re-check SoD under the lock).
    createdBy: row.createdBy,
    // GAP-PROCUREMENT-GRN-DETAIL-02 — the three-way match is only meaningful once
    // the GRN has actually been inspected. Report it as undefined (not the
    // schema-default `false`) while no inspection row exists, so an uninspected
    // GRN reads as a neutral "pending" state on the detail page instead of a red
    // mismatch. Once inspected, the real boolean is returned.
    threeWayMatch: inspection ? row.threeWayMatch : undefined,
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

/**
 * PERF-019: the item-count portion was N+1 — one findGrnItemsByGrnId call
 * PER GRN row (concurrent via Promise.all, but still N round trips, and
 * fetched full item rows just to take .length). Now a single grouped-count
 * query across all GRN ids, computed via SQL COUNT/GROUP BY instead of
 * fetched-then-counted-in-JS. Response shape and per-row field mapping are
 * unchanged from the original loop.
 */
export async function listGrns(tenantId: string, limit: number, offset: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "grns", `list:${limit}:${offset}`),
    () => repo.listGrnsByTenant(tenantId, limit, offset),
    60,
  );
  const grnRows = rows ?? [];
  const vendors = await vendorRepo.listVendorsByTenant(tenantId, 500);
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  const countById = await repo.countItemsByGrnIds(grnRows.map((row) => row.id));
  // GAP2-PROCUREMENT-GRN-DETAIL-06 — resolve each GRN's opaque poRef to a human
  // PO number via a SINGLE tenant PO fetch (no N+1), mirroring the vendor-name
  // map above, so the list column can show the PO number instead of the raw
  // `procurement_po:<uuid>` composite.
  const pos = await poRepo.listPosByTenant(tenantId, 500);
  const poNoById = new Map(pos.map((p) => [p.id, p.poNo]));

  return grnRows.map((row) => {
    const status = mapGrnStatus(row.status);
    const poId = poIdFromRef(row.poRef);
    // GAP-PROCUREMENT-GRN-04 — the three-way match is only known once the GRN
    // has a quality decision (accepted/rejected/partially_rejected). While it is
    // still draft/under_inspection/received/quality_check the match is pending,
    // so report undefined rather than the schema-default `false` — otherwise the
    // list would show a red "Mismatch" for every uninspected GRN, disagreeing
    // with the detail page.
    const decided = status === "accepted" || status === "rejected" || status === "partially_rejected";
    return {
      id: row.id,
      grnNo: row.grnNo,
      poRef: row.poRef,
      poId: poId ?? undefined,
      poNo: (poId ? poNoById.get(poId) : undefined) ?? undefined,
      vendor: vendorNameById.get(row.vendorId) ?? row.vendorId.slice(0, 8),
      receivedDate: String(row.receivedDate),
      receivedBy: row.createdBy,
      itemCount: countById.get(row.id) ?? 0,
      totalValue: 0,
      status,
      threeWayMatch: decided ? row.threeWayMatch : undefined,
    };
  });
}

function mapGrnStatus(status: string): "draft" | "under_inspection" | "received" | "quality_check" | "accepted" | "partially_rejected" | "rejected" {
  const valid = ["draft", "under_inspection", "received", "quality_check", "accepted", "partially_rejected", "rejected"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}
