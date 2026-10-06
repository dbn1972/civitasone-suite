import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as vendorRepo from "../vendor/repo.js";
import type { RfqRow } from "./schema.js";

function mapRfqStatus(status: string): "draft" | "issued" | "closed" | "cancelled" | "awarded" {
  const valid = ["draft", "issued", "closed", "cancelled", "awarded"] as const;
  return (valid as readonly string[]).includes(status) ? status as typeof valid[number] : "draft";
}

/** Today's Asia/Kolkata calendar day as "YYYY-MM-DD" (bare-date comparable). */
function todayIstDay(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

/**
 * GAP-PROCUREMENT-RFQ-DETAIL-03 / -06 (sealed-bid discipline, GFR): a vendor's
 * quoted amount must not be visible while the RFQ is still OPEN for responses,
 * exactly as the tender module withholds a bid amount until the financial
 * envelope is opened (tender/queries.ts's `financialOpened` gate). An RFQ is
 * "open" while its status is draft/issued AND its closing day has not yet
 * passed (compared in IST, never server-local). Once it is closed/awarded, or
 * the closing day is in the past, amounts are revealed so the officer can
 * compare quotes and award. Comparison in bare "YYYY-MM-DD" space is safe:
 * closing_date is a DATE column (no time component).
 */
function rfqAmountsSealed(status: string, closingDate: string): boolean {
  if (status === "closed" || status === "awarded" || status === "cancelled") return false;
  // draft/issued: sealed until the closing day has passed.
  return closingDate >= todayIstDay();
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
  // DOM-011: previously hardcoded `[]` -- vendor responses were queued
  // (COMMANDS.rfqRespond) but nothing ever consumed or persisted them, so
  // there was nothing real to return here. See rfq/consumer.ts's rfqRespond
  // handler for where they are now actually stored.
  const responseRows = await repo.findResponsesByRfq(id, tenantId);
  // PERF-005: was one findVendorById() per response row (N+1). Batch-fetch
  // every distinct vendor for this RFQ's responses in a single query.
  const vendorsById = await vendorRepo.findVendorsByIds(
    [...new Set(responseRows.map((r) => r.vendorId))],
    tenantId,
  );
  // GAP-PROCUREMENT-RFQ-DETAIL-03/-06: withhold quoted amounts (and the
  // per-line rates that would reveal them) while the RFQ is still open.
  const sealed = rfqAmountsSealed(row.status, String(row.closingDate));
  const responses = responseRows.map((r) => {
    const vendor = vendorsById.get(r.vendorId);
    // GAP-PROCUREMENT-RFQ-DETAIL-02: per-line rates for the comparative
    // statement, from the response's own `items` snapshot. Only surfaced once
    // amounts are unsealed. Each entry keys an rfq line by itemId (when the
    // vendor quoted against a real line) or by itemName (a proposed substitute).
    const rawItems = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
    const lineRates = sealed
      ? []
      : rawItems.map((it) => ({
          itemId: typeof it.itemId === "string" ? it.itemId : undefined,
          itemName: typeof it.itemName === "string" ? it.itemName : undefined,
          // Integer minor units as a string (bigint-derived): no float rupees
          // cross the wire. Same rupees->paise rounding as domain.ts's total.
          unitPriceMinor: BigInt(Math.round((typeof it.unitPrice === "number" && Number.isFinite(it.unitPrice) ? it.unitPrice : 0) * 100)).toString(),
        }));
    return {
      vendorId: r.vendorId,
      vendorName: vendor?.name ?? r.vendorId,
      // GAP-PROCUREMENT-RFQ-DETAIL-01: response id so the detail page can award
      // this specific quote (POST .../award takes { responseId }).
      responseId: r.id,
      // Sealed: amount withheld (undefined), not a misleading 0.
      totalAmountMinor: sealed ? undefined : String(r.totalAmountMinor),
      sealed,
      lineRates,
      submittedAt: r.submittedAt instanceof Date ? r.submittedAt.toISOString() : String(r.submittedAt),
      status: r.status,
    };
  });
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
    awardedResponseId: row.awardedResponseId ?? null,
    lineItems: items.map((i) => ({ itemId: i.id, itemName: i.itemName, quantity: i.quantity, unit: i.unit })),
    responses,
  };
}
