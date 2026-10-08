import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as mastersRepo from "../masters/repo.js";
import type { PaymentRow } from "./schema.js";

/**
 * GAP2-FINANCE-BILLS-VENDORNAME-01: shown when a bill's vendor id cannot be
 * resolved to a tenant vendor master row (deleted vendor, or a legacy bill
 * citing an id that was never a tenant vendor). An explicit honest label, never
 * a raw-UUID-derived token presented as the authoritative payee.
 */
const UNKNOWN_VENDOR = "Unknown vendor";


// Bigint-safe end to end (no Number() conversion) — ports the same
// rupee/paise-split + Indian lakh/crore grouping algorithm the frontend's
// formatMoney() (apps/web/src/lib/formatters.ts) already uses, so this
// display string matches it exactly instead of drifting via float division.
// The rest of this file guards the identical risk with explicit .toString()
// (see the "H3" comments below) — this was the one call site still doing
// Number(minor) / 100.
function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  const rupeesStr = rupees.toString();
  const grouped = rupeesStr.length <= 3
    ? rupeesStr
    : rupeesStr.slice(0, rupeesStr.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + rupeesStr.slice(-3);
  return `${negative ? "-" : ""}₹${grouped}.${paise.toString().padStart(2, "0")}`;
}

/**
 * Explicit BigInt coercion for a `*Minor` money field read back through
 * `cache.getOrLoad`/`listOrLoad`. `@civitasone/cache`'s serialize() JSON
 * .stringify()s whatever it caches; since JSON has no BigInt type, the
 * global `BigInt.prototype.toJSON` patch (shared/bigint-json.ts) turns every
 * bigint field into a plain decimal STRING before it's written to the store
 * — but deserialize() is a bare `JSON.parse` with no reviver to turn it back.
 * A cache-MISS read comes straight from Drizzle, which hands back a real
 * `bigint` (the schema's `mode: "bigint"` column type); a cache-HIT read
 * hands back a `string` carrying the identical decimal value. `BillRow` /
 * `AdvanceRow` type these fields `bigint` unconditionally, so nothing
 * downstream re-checks this at runtime — `formatMinor()`'s `abs / 100n` (or
 * a raw `a - b` on two such fields) throws "Cannot mix BigInt and other
 * types, use explicit conversions" the instant it runs on a post-cache-hit
 * value.
 *
 * This was invisible before procurement-service went live only because the
 * bills/advances being listed were empty arrays — `[].map()` never once
 * invokes the vulnerable callback, cache-hit or not. Once procurement's
 * three-way-match consumer (see payments/consumer.ts) started inserting real
 * rows, the very next read within the cache TTL hit this path.
 *
 * `BigInt(x)` is a no-op for an already-bigint `x`, so calling this is safe
 * on both the fresh and the cached path — the same explicit-conversion
 * pattern payments/consumer.ts already applies to the identical hazard on
 * inbound queue messages (`const netMinor = BigInt(p.netMinor);`), just
 * applied here on the read side too.
 *
 * Exported (pure, no DB/cache) so this exact coercion is unit-testable
 * directly.
 */
export function toMinorBigInt(minor: bigint | string | number): bigint {
  return typeof minor === "bigint" ? minor : BigInt(minor);
}

function mapPaymentStatus(status: string): PaymentSummary["status"] {
  if (status === "released" || status === "completed") return "Released";
  if (status === "failed") return "Failed";
  if (status === "pending_approval") return "Pending Approval";
  return "Queued";
}

export type PaymentSummary = {
  id: string;
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  /** GAP-FINANCE-PAYMENTS-05: exact paise as a base-10 string, so the register can sort numerically. */
  amountMinor: string;
  status: "Queued" | "Released" | "Pending Approval" | "Failed";
};

export type PaymentsSummary = {
  total: number;
  released: number;
  pendingApproval: number;
  failed: number;
};

/**
 * GAP2-FINANCE-PAYMENTS-TOTALS-03: tenant-wide payment totals for the register
 * stat cards, aggregated in the database so they are never capped at a page.
 * Reuses mapPaymentStatus so the buckets match the rows the table renders.
 */
export async function getPaymentsSummary(tenantId: string): Promise<PaymentsSummary> {
  const { total, byStatus } = await repo.getPaymentStatusCounts(tenantId);
  const summary: PaymentsSummary = { total, released: 0, pendingApproval: 0, failed: 0 };
  for (const [status, n] of Object.entries(byStatus)) {
    const bucket = mapPaymentStatus(status);
    if (bucket === "Released") summary.released += n;
    else if (bucket === "Pending Approval") summary.pendingApproval += n;
    else if (bucket === "Failed") summary.failed += n;
  }
  return summary;
}

export async function getPayment(id: string, tenantId: string): Promise<PaymentRow | null> {
  const row = await cache.getOrLoad<PaymentRow>(
    cache.makeKey(tenantId, "payment", id),
    () => repo.findPaymentByIdAndTenant(id, tenantId)
  );
  // Tenant isolation: reject if DB row belongs to a different tenant (defence after cache miss).
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listPayments(tenantId: string, limit: number, offset: number): Promise<{ data: PaymentSummary[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, "payment", `list:${limit}:${offset}`, async () => {
    const rows = await repo.listPaymentsByTenant(tenantId, limit, offset);
    // Build bill->vendor map for beneficiary resolution, then resolve vendor
    // ids to their registered master-data names in ONE batched query
    // (GAP2-FINANCE-BILLS-VENDORNAME-01) — no N+1, no hard-coded fixture.
    const uniqueBillIds = [...new Set(rows.map((r) => r.billId))];
    const bills = await repo.findBillsByIds(uniqueBillIds, tenantId);
    const billToVendor = new Map(bills.map((b) => [b.id, b.vendorId]));
    const vendorNames = await mastersRepo.getVendorNamesByIds(tenantId, bills.map((b) => b.vendorId));
    const beneficiaryFor = (billId: string): string => {
      const vendorId = billToVendor.get(billId);
      return (vendorId && vendorNames.get(vendorId)) || UNKNOWN_VENDOR;
    };
    return {
      data: rows.map((r) => ({
        id: r.id,
        referenceId: r.eftRef ?? ("PAY-" + r.id.slice(-6).toUpperCase()),
        beneficiary: beneficiaryFor(r.billId),
        amountDisplay: formatMinor(r.amountMinor),
        amountMinor: toMinorBigInt(r.amountMinor).toString(),
        status: mapPaymentStatus(r.status),
      })),
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}

function mapBillStatus(status: string): "pending" | "passed" | "paid" | "rejected" | "on_hold" | "under_review" {
  if (status === "approved" || status === "passed") return "passed";
  if (status === "paid") return "paid";
  if (status === "rejected") return "rejected";
  if (status === "on_hold") return "on_hold";
  if (status === "under_review") return "under_review";
  return "pending";
}

export async function listBillSummaries(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "bills", `list:${limit}:${offset}`),
    () => repo.listBillsByTenant(tenantId, limit, offset),
    60,
  );
  const list = rows ?? [];
  // GAP2-FINANCE-BILLS-VENDORNAME-01: resolve the payee from the vendor master
  // (batched), not a 4-entry seed fixture. An unresolved vendor shows an honest
  // "Unknown vendor", never a raw-UUID token.
  const vendorNames = await mastersRepo.getVendorNamesByIds(tenantId, list.map((row) => row.vendorId));
  return list.map((row) => {
    const netMinor = toMinorBigInt(row.netMinor);
    return {
      id: row.id,
      billNo: row.billNo,
      vendor: vendorNames.get(row.vendorId) ?? UNKNOWN_VENDOR,
      // H3: string to avoid 2^53 precision loss on large government bill amounts.
      amount: netMinor.toString(),
      amountDisplay: formatMinor(netMinor),
      submittedDate: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
      dueDate: undefined,
      status: mapBillStatus(row.status),
      poRef: row.poRef ?? undefined,
      threeWayMatch: "na" as const,
    };
  });
}

/**
 * GFR Rule 230: advances outstanding beyond due date must be flagged as overdue.
 * If the advance is still "active" and dueDate is in the past, surface status as "overdue".
 */
function resolveAdvanceStatus(row: { status: string; dueDate: string | null }): "active" | "adjusted" | "overdue" | "closed" {
  if (row.status === "active" && row.dueDate) {
    const due = new Date(row.dueDate);
    if (due < new Date()) {
      return "overdue";
    }
  }
  return row.status as "active" | "adjusted" | "overdue" | "closed";
}

export async function listAdvances(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "advances", `list:${limit}:${offset}`),
    () => repo.listAdvancesByTenant(tenantId, limit, offset),
    60,
  );
  return (rows ?? []).map((row) => {
    const amountMinor = toMinorBigInt(row.amountMinor);
    const adjustedMinor = toMinorBigInt(row.adjustedMinor);
    return {
      id: row.id,
      advanceNo: row.advanceNo,
      beneficiary: row.beneficiary,
      type: (row.type as "employee" | "vendor" | "other"),
      // The stated purpose was stored but never returned, so the register
      // showed the advance TYPE under a "Purpose" heading (GAP-...-ADVANCES-NEW-06).
      ...(row.purpose ? { purpose: row.purpose } : {}),
      // H3: string to avoid 2^53 precision loss on large government advance amounts.
      amount: amountMinor.toString(),
      disbursedDate: String(row.disbursedDate),
      dueDate: row.dueDate ? String(row.dueDate) : undefined,
      adjustedAmount: adjustedMinor.toString(),
      balance: (amountMinor - adjustedMinor).toString(),
      status: resolveAdvanceStatus({ status: row.status, dueDate: row.dueDate ? String(row.dueDate) : null }),
      ...(row.sanctionAuthority ? { sanctionAuthority: row.sanctionAuthority } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
    };
  });
}

export async function listUCs(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "uc", `list:${limit}`),
    () => repo.listUCsByTenant(tenantId, limit),
    60,
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    ucNo: row.ucNo,
    grantRef: row.grantRef ?? undefined,
    grantee: row.grantee,
    // H3: string to avoid 2^53 precision loss on large government UC amounts.
    amount: row.amountMinor.toString(),
    periodFrom: String(row.periodFrom),
    periodTo: String(row.periodTo),
    submittedDate: row.submittedDate ? String(row.submittedDate) : undefined,
    status: (row.status as "pending" | "submitted" | "verified" | "rejected"),
    ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    declarationAccepted: row.declarationAccepted ?? false,
    resubmitCount: row.resubmitCount ?? 0,
    createdBy: row.createdBy,
  }));
}

export async function getBillDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "bill", id),
    () => repo.findBillByIdAndTenant(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const threeWayMatch: "matched" | "pending" | "na" = (row.poRef && row.grnRef) ? "matched" : (row.poRef || row.grnRef) ? "pending" : "na";
  const netMinor = toMinorBigInt(row.netMinor);
  // GAP2-FINANCE-BILLS-VENDORNAME-01: real master-data vendor name, honest
  // "Unknown vendor" fallback — never a raw-UUID token on a money document.
  const vendor = await mastersRepo.getVendorById(tenantId, row.vendorId);
  return {
    id: row.id,
    billNo: row.billNo,
    vendor: vendor?.name ?? UNKNOWN_VENDOR,
    // H3: string to avoid 2^53 precision loss on large government bill amounts.
    amount: netMinor.toString(),
    amountDisplay: formatMinor(netMinor),
    submittedDate: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    status: mapBillStatus(row.status),
    poRef: row.poRef ?? undefined,
    grnRef: row.grnRef ?? undefined,
    threeWayMatch,
    lineItems: [],
  };
}
