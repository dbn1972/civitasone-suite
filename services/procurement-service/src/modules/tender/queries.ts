import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TenderRow } from "./schema.js";

function mapTenderStatus(status: string): "draft" | "published" | "evaluation" | "awarded" | "cancelled" {
  const valid = ["draft", "published", "evaluation", "awarded", "cancelled"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}

function mapTenderType(type: string): "open" | "limited" | "single_source" | "gem" {
  const valid = ["open", "limited", "single_source", "gem"] as const;
  return (valid as readonly string[]).includes(type) ? type as typeof valid[number] : "open";
}

export async function listTenders(tenantId: string, limit: number, offset: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "tenders", `list:${limit}:${offset}`),
    () => repo.listTendersByTenant(tenantId, limit, offset),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    tenderNo: row.tenderNo,
    title: row.title,
    type: mapTenderType(row.type),
    estimatedValue: Number(row.estimatedMinor) / 100,
    publishDate: row.publishDate ? String(row.publishDate) : undefined,
    bidClosingDate: String(row.bidClosingDate),
    openingDate: row.openingDate ? String(row.openingDate) : undefined,
    status: mapTenderStatus(row.status),
    bidsReceived: row.bidsReceived,
  }));
}

export async function getTenderDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad<TenderRow>(
    cache.makeKey(tenantId, "tender", id),
    () => repo.findTenderById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const bids = await repo.findBidsByTender(id);
  return {
    id: row.id,
    tenderNo: row.tenderNo,
    title: row.title,
    type: mapTenderType(row.type),
    estimatedValue: Number(row.estimatedMinor) / 100,
    publishDate: row.publishDate ? String(row.publishDate) : undefined,
    bidClosingDate: String(row.bidClosingDate),
    openingDate: row.openingDate ? String(row.openingDate) : undefined,
    status: mapTenderStatus(row.status),
    bidsReceived: row.bidsReceived,
    scope: row.scope ?? undefined,
    eligibilityCriteria: row.eligibility ?? undefined,
    bids: bids.map((b) => ({
      vendorId: b.vendorId,
      vendorName: b.vendorName,
      bidAmount: Number(b.bidAmount) / 100,
      technicalScore: b.technicalScore ?? undefined,
      financialScore: b.financialScore ?? undefined,
      status: b.status,
    })),
  };
}
