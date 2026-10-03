import type { FinanceChangeRequest } from "@civitasone/types";

/** Roles that may approve / reject a finance change request (finance-service DECIDER_ROLES). */
export const CHANGE_REQUEST_DECIDER_ROLES = ["finance_admin", "super_admin"];

/** Pure view-model for one pending request: what it is, and what the viewer may do about it. */
export type ChangeRequestView = {
  id: string;
  kind: FinanceChangeRequest["kind"];
  subject: string;
  /** Short factual detail lines (old -> new HoA code, entry count, ...). */
  details: string[];
  reason: string;
  requestedAt: string;
  mine: boolean;
  action: "decide" | "withdraw" | "wait";
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Sum the debit paise of an opening-balance batch (bigint-safe, strings on the wire). */
export function openingBalanceTotalMinor(entries: unknown): bigint {
  if (!Array.isArray(entries)) return 0n;
  let total = 0n;
  for (const e of entries) {
    const d = typeof e === "object" && e !== null ? (e as { debitMinor?: unknown }).debitMinor : undefined;
    if (typeof d === "string" && /^\d+$/.test(d)) total += BigInt(d);
  }
  return total;
}

export function toChangeRequestView(
  r: FinanceChangeRequest,
  viewerId: string | null,
  canDecide: boolean,
  formatMoney: (minor: bigint) => string,
): ChangeRequestView {
  const mine = viewerId !== null && r.requestedBy === viewerId;
  const p = r.payload;
  let subject = r.subjectKey;
  const details: string[] = [];
  if (r.kind === "hoa_change") {
    subject = str(p.headCode) || r.subjectKey;
    details.push(`${str(p.oldHoaCode) || "—"} → ${str(p.hoaCode)}`);
  } else if (r.kind === "settings_relax") {
    const changes = typeof p.changes === "object" && p.changes !== null ? (p.changes as Record<string, unknown>) : {};
    // the controls this request switches OFF
    for (const [k, v] of Object.entries(changes)) if (v === false) details.push(k);
  } else if (r.kind === "opening_balances_enter") {
    const entries = Array.isArray(p.entries) ? p.entries : [];
    details.push(`${entries.length}`);
    details.push(formatMoney(openingBalanceTotalMinor(p.entries)));
  }
  return {
    id: r.id, kind: r.kind, subject, details, reason: r.reason, requestedAt: r.requestedAt, mine,
    action: mine ? "withdraw" : canDecide ? "decide" : "wait",
  };
}
