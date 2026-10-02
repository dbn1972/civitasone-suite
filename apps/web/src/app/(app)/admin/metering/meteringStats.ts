import { normStatus, str } from "../_components/status";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GET /v1/billing/metering rows. No billing-service route serves this path in
 * the current tree, so the field set and the unit of `amount` are the page's
 * long-standing contract, not a verified one (see GAP-ADMIN-METERING-02):
 * `amount` is therefore left unformatted and typed as an opaque value.
 */
export type MeterRow = {
  tenant: string;
  apiCalls: string | number | null;
  storage: string | number | null;
  users: string | number | null;
  billingPeriod: string;
  amount: string | number | null;
  status: string;
};

function opaque(v: unknown): string | number | null {
  return typeof v === "string" || typeof v === "number" ? v : null;
}

export function toMeterRows(raw: Record<string, unknown>[]): MeterRow[] {
  return raw.map((r) => ({
    tenant: str(r.tenant),
    apiCalls: opaque(r.apiCalls),
    storage: opaque(r.storage),
    users: opaque(r.users),
    billingPeriod: str(r.billingPeriod),
    amount: opaque(r.amount),
    status: str(r.status),
  }));
}

// GAP-ADMIN-METERING-05: Pending is an explicit list, not a remainder that
// absorbed every unknown status.
const PENDING = new Set(["pending", "unbilled", "pending billing"]);

export function meteringStats(rows: MeterRow[]) {
  let billed = 0, overdue = 0, pending = 0;
  for (const r of rows) {
    const s = normStatus(r.status);
    if (s === "billed") billed++;
    else if (s === "overdue") overdue++;
    else if (PENDING.has(s)) pending++;
  }
  return { total: rows.length, billed, pending, overdue, other: rows.length - billed - pending - overdue };
}

// GAP-ADMIN-METERING-06: deliberate tones (shared StatusPill has no "billed").
const TONES: Record<string, PillVariant> = {
  billed: "good",
  overdue: "bad",
  pending: "warn",
  unbilled: "warn",
  "pending billing": "warn",
  draft: "mut",
};
export function meterStatusTone(status: string): PillVariant {
  return TONES[normStatus(status)] ?? "info";
}
