import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TenderRow } from "./schema.js";

const TENDER_STATUSES = [
  "draft", "published", "technical_evaluation", "financial_evaluation",
  "evaluation", "awarded", "cancelled",
] as const;

function mapTenderStatus(status: string): typeof TENDER_STATUSES[number] {
  return (TENDER_STATUSES as readonly string[]).includes(status)
    ? status as typeof TENDER_STATUSES[number] : "draft";
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
    status: mapTenderStatus(row.status) === "technical_evaluation" || mapTenderStatus(row.status) === "financial_evaluation"
      ? "evaluation" : mapTenderStatus(row.status),
    bidsReceived: row.bidsReceived,
  }));
}

export async function getTenderDetail(id: string, tenantId: string) {
  const row = await repo.findTenderById(id);
  if (!row || row.tenantId !== tenantId) return null;
  const bids = await repo.findBidsByTender(id);
  const mapped = mapTenderStatus(row.status);
  return {
    id: row.id,
    tenderNo: row.tenderNo,
    title: row.title,
    type: mapTenderType(row.type),
    estimatedValue: Number(row.estimatedMinor) / 100,
    publishDate: row.publishDate ? String(row.publishDate) : undefined,
    bidClosingDate: String(row.bidClosingDate),
    openingDate: row.openingDate ? String(row.openingDate) : undefined,
    status: mapped === "technical_evaluation" || mapped === "financial_evaluation" ? "evaluation" : mapped,
    bidsReceived: row.bidsReceived,
    scope: row.scope ?? undefined,
    eligibilityCriteria: row.eligibility ?? undefined,
    bids: bids.map((b) => ({
      vendorId: b.vendorId,
      vendorName: b.vendorName,
      // SEALING GUARD: financial value only surfaced once the envelope is opened.
      bidAmount: b.financialOpened ? Number(b.bidAmount) / 100 : undefined,
      technicalScore: b.technicalScore ?? undefined,
      financialScore: b.financialScore ?? undefined,
      status: b.status,
    })),
  };
}

/**
 * Two-bid evaluation view. Each bid shows technical state always, but the
 * financialAmount is WITHHELD (null) until the bid's financial envelope is
 * opened (sealed=false) — proving the core integrity property at the read layer.
 */
export async function getEvaluationView(tenderId: string, tenantId: string) {
  const tender = await repo.findTenderById(tenderId);
  if (!tender || tender.tenantId !== tenantId) return null;
  const bids = await repo.findBidsByTender(tenderId);
  const revealed = await repo.getRevealedFinancials(tenderId, tenantId);
  const revealedByBid = new Map(revealed.map((r) => [r.bidId, r.amountMinor]));
  return {
    tenderId,
    tenderNo: tender.tenderNo,
    status: tender.status,
    bids: bids.map((b) => {
      const amt = revealedByBid.get(b.id);
      return {
        bidId: b.id,
        bidNo: b.bidNo ?? undefined,
        vendorId: b.vendorId,
        vendorName: b.vendorName,
        technicalScore: b.technicalScore ?? undefined,
        technicalQualified: b.technicalQualified ?? undefined,
        financialSealed: amt === undefined,
        // Paise as string (no Number() on paise); null while sealed.
        financialAmountMinor: amt !== undefined ? amt.toString() : null,
        rank: b.rank ?? undefined,
        isL1: b.isL1,
        status: b.status,
      };
    }),
  };
}
