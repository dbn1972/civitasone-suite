import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as docsRepo from "./docs-repo.js";
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
    // GAP-PROCUREMENT-TENDERS-02: surface the real evaluation phase
    // (technical_evaluation / financial_evaluation) instead of collapsing both
    // to "evaluation", so the register can count and label them separately.
    // mapTenderStatus still guards against any unknown DB value.
    status: mapTenderStatus(row.status),
    bidsReceived: row.bidsReceived,
  }));
}

export async function getTenderDetail(id: string, tenantId: string) {
  const row = await repo.findTenderById(id);
  if (!row || row.tenantId !== tenantId) return null;
  const bids = await repo.findBidsByTender(id);
  // GAP-PROCUREMENT-TENDERS-DETAIL-05: load this tender's documents so the
  // detail page can show a document count and a NIT-present/missing cue, and
  // so Publish can be gated when no NIT has been attached. Read-only; failures
  // degrade to "no documents" rather than failing the whole detail view.
  const docs = await docsRepo.listDocsByTender(id, tenantId).catch(() => []);
  const hasNit = docs.some((d) => d.docType === "nit" && d.isCurrent);
  return {
    id: row.id,
    tenderNo: row.tenderNo,
    title: row.title,
    type: mapTenderType(row.type),
    estimatedValue: Number(row.estimatedMinor) / 100,
    // GAP-PROCUREMENT-TENDERS-DETAIL-05: EMD captured on create but never
    // surfaced before. Minor units (paise) as a number, matching estimatedValue
    // staying in major units — here we send the raw paise so the UI formats it
    // with formatMoney (which expects paise). Guard against the >2^53 case is
    // unnecessary for an EMD figure (always well under that).
    emdAmountMinor: Number(row.emdAmountMinor),
    publishDate: row.publishDate ? String(row.publishDate) : undefined,
    bidClosingDate: String(row.bidClosingDate),
    openingDate: row.openingDate ? String(row.openingDate) : undefined,
    // GAP-PROCUREMENT-TENDERS-DETAIL-02: surface the real evaluation phase
    // (technical_evaluation / financial_evaluation) rather than collapsing both
    // to "evaluation", so the lifecycle UI can gate Open-financial / Award on
    // the actual phase instead of guessing from whether a bidAmount is visible.
    // mapTenderStatus still guards any unknown DB value.
    status: mapTenderStatus(row.status),
    bidsReceived: row.bidsReceived,
    scope: row.scope ?? undefined,
    eligibilityCriteria: row.eligibility ?? undefined,
    // GAP-PROCUREMENT-TENDERS-DETAIL-03: identities for the UI-side maker-checker
    // gate (Award hidden/disabled for the creator and the technical evaluator).
    // The award consumer re-checks SoD in-txn — the server stays authoritative.
    createdBy: row.createdBy,
    techEvaluatedBy: row.techEvaluatedBy ?? null,
    // GAP-PROCUREMENT-TENDERS-DETAIL-05: NIT presence + document count so the
    // UI can gate Publish and show a "Documents (N)" / NIT-missing cue.
    hasNit,
    documentCount: docs.length,
    // GAP-PROCUREMENT-TENDERS-NEW-01/02: indent link + single-source
    // justification surfaced for the detail page.
    indentRef: row.indentRef ?? undefined,
    justificationCategory: row.justificationCategory ?? undefined,
    justification: row.justification ?? undefined,
    approvingAuthority: row.approvingAuthority ?? undefined,
    bids: bids.map((b) => ({
      // Needed by the web UI to submit per-bid technical evaluation results
      // (POST .../technical-evaluation takes { results: [{ bidId, ... }] }) —
      // previously omitted, so there was no way to address an individual bid.
      bidId: b.id,
      vendorId: b.vendorId,
      vendorName: b.vendorName,
      // SEALING GUARD: financial value only surfaced once the envelope is opened.
      bidAmount: b.financialOpened ? Number(b.bidAmount) / 100 : undefined,
      technicalScore: b.technicalScore ?? undefined,
      financialScore: b.financialScore ?? undefined,
      // GAP-PROCUREMENT-TENDERS-DETAIL-02: explicit per-bid envelope state so the
      // lifecycle UI gates Award on real data, not a guess from bidAmount.
      financialOpened: b.financialOpened,
      status: b.status,
    })),
  };
}

export type BidEvaluationSummary = {
  id: string;
  tender: string;
  // GAP-PROCUREMENT-BID-EVALUATION-05: opaque tender id so the web can link the
  // tender ref to /procurement/tenders/[id] (the ref string alone is not a
  // route key).
  tenderId: string;
  bidder: string;
  technicalScore: number;
  // GAP-PROCUREMENT-BID-EVALUATION-06 (sealed-bid discipline): the financial
  // score is withheld (null) until the financial envelope has been opened
  // (financialOpened=true). GFR sealed-bid integrity — nobody sees financial
  // standing while technical evaluation is still in progress.
  financialScore: number | null;
  totalScore: number;
  rank: number;
  status: string;
  financialOpened: boolean;
};

/**
 * Cross-tender bid-evaluation register (gap/routes.ts real-data lift).
 * totalScore is a simple average of technical/financial scores when both are
 * present AND the financial envelope is open — there is no weighted-formula
 * config yet, so we don't fabricate one. While the financial envelope is
 * sealed (financialOpened=false), financialScore is withheld (null) and
 * totalScore reflects the technical score only (GAP-PROCUREMENT-BID-EVALUATION-06).
 */
/** GAP2-PROCUREMENT-GAPLIST-03: true total count of technically-evaluated bids for meta.total. */
export async function countBidEvaluations(tenantId: string): Promise<number> {
  return repo.countBidEvaluationsByTenant(tenantId);
}

export async function listBidEvaluations(tenantId: string, limit: number, offset: number): Promise<BidEvaluationSummary[]> {
  const rows = await repo.listBidEvaluationsByTenant(tenantId, limit, offset);
  return rows.map((r) => {
    const tech = r.technicalScore ?? 0;
    const opened = r.financialOpened === true;
    // Sealed-bid guard: never surface the financial score before the envelope
    // is opened.
    const fin = opened ? (r.financialScore ?? 0) : null;
    const bothPresent = opened && r.technicalScore != null && r.financialScore != null;
    const totalScore = bothPresent
      ? Math.round((tech + (r.financialScore ?? 0)) / 2)
      : tech;
    return {
      id: r.bidId,
      tender: r.tenderNo,
      tenderId: r.tenderId,
      bidder: r.vendorName,
      technicalScore: tech,
      financialScore: fin,
      totalScore,
      rank: r.rank ?? 0,
      status: r.status,
      financialOpened: opened,
    };
  });
}

export type PreBidConferenceSummary = {
  id: string;
  // GAP-PROCUREMENT-PRE-BID-01: the opaque tender id so the web can link the
  // tender cell to /procurement/tenders/[id]. (It equals `id` today because a
  // "conference" is one tender's query thread, but surfaced explicitly so the
  // web does not rely on that coincidence.)
  tenderId: string;
  tender: string;
  date: string;
  queriesRaised: number;
  responses: number;
  // GAP-PROCUREMENT-PRE-BID-03: open (unanswered) queries — the actionable
  // number — computed server-side so the tile and table agree.
  openQueries: number;
  attendees: number;
  status: string;
};

/**
 * Pre-bid "conferences" are modeled here as aggregated pre-bid query threads
 * (procurementPrebidQueries), NOT scheduled meetings — there is no attendee
 * roster or meeting-date entity in this system, so `attendees` is always 0
 * and callers MUST surface `meta.reason` explaining the substitution rather
 * than presenting it as a genuine attendance figure.
 */
/** GAP2-PROCUREMENT-GAPLIST-03: true total count of pre-bid-conference (tender) threads for meta.total. */
export async function countPreBidConferenceAggregates(tenantId: string): Promise<number> {
  return docsRepo.countPrebidAggregatesByTenant(tenantId);
}

export async function listPreBidConferenceAggregates(tenantId: string, limit: number, offset: number): Promise<PreBidConferenceSummary[]> {
  const rows = await docsRepo.listPrebidAggregatesByTenant(tenantId, limit, offset);
  return rows.map((r) => {
    const queriesRaised = Number(r.queriesRaised);
    const responses = Number(r.responses);
    return {
      id: r.tenderId,
      tenderId: r.tenderId,
      tender: r.tenderNo,
      date: new Date(r.firstQueryAt).toISOString().slice(0, 10),
      queriesRaised,
      responses,
      openQueries: Math.max(0, queriesRaised - responses),
      attendees: 0,
      status: Number(r.publishedCount) >= queriesRaised && queriesRaised > 0 ? "published" : "pending",
    };
  });
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
