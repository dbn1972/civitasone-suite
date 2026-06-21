import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RfqRow } from "./schema.js";

function mapRfqStatus(status: string): "draft" | "issued" | "closed" | "cancelled" | "awarded" {
  const valid = ["draft", "issued", "closed", "cancelled", "awarded"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}

export async function getRfq(id: string, tenantId: string): Promise<RfqRow | null> {
  return cache.getOrLoad<RfqRow>(
    cache.makeKey(tenantId, "rfq", id),
    () => repo.findRfqById(id)
  );
}

export async function listRfqs(tenantId: string, limit: number, offset: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "rfqs", `list:${limit}:${offset}`),
    () => repo.listRfqsByTenant(tenantId, limit, offset),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    rfqNo: row.rfqNo,
    title: row.title,
    indentRef: row.indentRef ?? undefined,
    vendorsInvited: row.vendorsInvited,
    responsesReceived: row.responsesReceived,
    closingDate: String(row.closingDate),
    status: mapRfqStatus(row.status),
  }));
}

export async function getRfqDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad<RfqRow>(
    cache.makeKey(tenantId, "rfq", id),
    () => repo.findRfqById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const items = await repo.findRfqItemsByRfq(id);
  return {
    id: row.id,
    rfqNo: row.rfqNo,
    title: row.title,
    description: row.description ?? undefined,
    indentRef: row.indentRef ?? undefined,
    vendorsInvited: row.vendorsInvited,
    responsesReceived: row.responsesReceived,
    closingDate: String(row.closingDate),
    status: mapRfqStatus(row.status),
    lineItems: items.map((i) => ({ itemName: i.itemName, quantity: i.quantity, unit: i.unit })),
    responses: [],
  };
}
