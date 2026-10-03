import { normStatus, str } from "../_components/status";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GET /v1/billing/metering rows (billing-service usage/queries.ts getMetering).
 * GAP-ADMIN-METERING-02: `amountMinor` is integer PAISE as a string, never rupees;
 * the table renders it with formatMoney (lakh/crore grouping), the same unit and
 * formatter the invoice register uses.
 */
export type MeterRow = {
  tenant: string;
  apiCalls: string | number | null;
  storage: string | number | null;
  users: string | number | null;
  billingPeriod: string;
  amountMinor: string | number | null;
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
    amountMinor: opaque(r.amountMinor),
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
