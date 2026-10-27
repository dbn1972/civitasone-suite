import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { pricePerMonthMinor } from "./domain.js";
import * as subscriptions from "../subscriptions/queries.js";
import * as invoices from "../invoices/queries.js";
import { fetchTenantEdition } from "../../shared/tenant-client.js";

/**
 * F9: one edition-aware read for the tenant-admin Plans page: the plan catalogue with its
 * limits, the tenant's current plan, trial days left, GST invoice rows and the tenant edition
 * (which decides the payment modes shown). Shaped to the web PlansData contract.
 *
 * Plan limits come from plans.billing_plan_features (max_users, storage_gb, max_api_calls and
 * one `module:<name>` row per included module). A limit nobody configured is 0 / no modules,
 * never an invented value.
 */
export interface TenantPlanSummary {
  id: string; name: string; pricePerMonth: number;
  maxUsers: number; storageGb: number; maxApiCalls: number; modules: string[];
}
export interface TenantInvoiceSummary {
  id: string; date: string; amount: number; status: "paid" | "pending" | "failed";
  invoiceNumber: string | null; supplierGstin: string | null; recipientGstin: string | null; placeOfSupply: string | null;
  cgstMinor: number; sgstMinor: number; igstMinor: number;
}
export interface TenantPlansOverview {
  plans: TenantPlanSummary[]; currentPlanId: string; invoices: TenantInvoiceSummary[];
  trialDaysLeft: number | null; edition: string | null;
}

const DAY_MS = 86_400_000;

/**
 * The web PlansData contract carries these figures as JSON numbers, so a bigint paise value is
 * narrowed here. It throws instead of silently losing precision above 2^53 - 1 (about 9e13 rupees).
 */
function toSafeNumber(v: bigint | string): number {
  const b = BigInt(v);
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("money value exceeds the safe integer range");
  }
  return Number(b); // bigint-safe: range-checked above
}

function invoiceStatus(s: string): "paid" | "pending" | "failed" {
  if (s === "paid") return "paid";
  if (s === "cancelled" || s === "waived") return "failed";
  return "pending";
}

export async function getTenantPlansOverview(tenantId: string, authorization: string | undefined, now: Date = new Date()): Promise<TenantPlansOverview> {
  const [plans, features, sub, inv, edition] = await Promise.all([
    cache.getOrLoad("billing:platform:plans", () => repo.list()),
    repo.listFeatures(),
    subscriptions.getSubscription(tenantId),
    invoices.listInvoices(tenantId),
    fetchTenantEdition(authorization),
  ]);
  const limit = (planId: string, key: string): number => {
    const f = features.find((x) => x.planId === planId && x.featureKey === key);
    return f?.limitValue == null ? 0 : toSafeNumber(f.limitValue);
  };
  const trialEnds = sub?.status === "trial" && sub.trialExpiresAt ? Date.parse(sub.trialExpiresAt) : NaN;
  return {
    plans: (plans ?? []).map((p) => ({
      id: p.id, name: p.name, pricePerMonth: toSafeNumber(pricePerMonthMinor(BigInt(p.priceMinor), p.interval)),
      maxUsers: limit(p.id, "max_users"), storageGb: limit(p.id, "storage_gb"), maxApiCalls: limit(p.id, "max_api_calls"),
      modules: features.filter((f) => f.planId === p.id && f.featureKey.startsWith("module:")).map((f) => f.featureKey.slice("module:".length)),
    })),
    currentPlanId: sub?.planId ?? "",
    // A draft is not yet a tax invoice: only issued-and-later bills are shown to the tenant.
    invoices: inv.filter((i) => i.status !== "draft").map((i) => ({
      id: i.id,
      // The cache may hand back an ISO string instead of a Date; a row with no issue date falls back to its period.
      date: i.issuedAt ? new Date(i.issuedAt).toISOString() : `${i.periodMonth}-01T00:00:00.000Z`,
      amount: toSafeNumber(i.totalMinor),
      status: invoiceStatus(i.status),
      invoiceNumber: i.invoiceNumber,
      supplierGstin: i.supplierGstin, recipientGstin: i.recipientGstin, placeOfSupply: i.placeOfSupply,
      cgstMinor: toSafeNumber(i.cgstMinor), sgstMinor: toSafeNumber(i.sgstMinor), igstMinor: toSafeNumber(i.igstMinor),
    })),
    trialDaysLeft: Number.isNaN(trialEnds) ? null : Math.max(0, Math.ceil((trialEnds - now.getTime()) / DAY_MS)),
    edition,
  };
}
