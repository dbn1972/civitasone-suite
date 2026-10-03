import type { PillVariant } from "@/app/_components/ds/StatusPill";
import { parseRupeesToPaise } from "@/lib/money";

/**
 * Shared presentation helpers for the payments register and the payment
 * detail page, so both read the same reference, tone and gating rules.
 */

/** "Pending Approval" / "pending_approval" / "pending-approval" -> "pending approval". */
export function paymentStatusKey(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * GAP-FINANCE-PAYMENTS-03 / PAYMENTS-DETAIL-07: explicit tone for the one
 * payment status the global StatusPill map must not decide. "Released" on a
 * payment means the money went out (green); the shared map reserves the word
 * for guarantee registers where it means "returned" (neutral). Every other
 * payment status (pending approval -> amber, queued -> grey, failed -> red,
 * completed -> green) comes from the shared map.
 */
export function paymentStatusVariant(status: string | null | undefined): PillVariant | undefined {
  const key = paymentStatusKey(status);
  return key === "released" || key === "completed" ? "good" : undefined;
}

/**
 * Statuses from which finance-service refuses submit-approval (mirrors
 * PAYMENT_SUBMIT_BLOCKED_STATUSES in payments/domain.ts): terminal states,
 * plus pending approval where an eFile is already open.
 */
const SUBMIT_BLOCKED = new Set(["released", "completed", "failed", "cancelled", "pending approval"]);

/** GAP-FINANCE-PAYMENTS-DETAIL-03: whether "Raise for approval" may be offered. */
export function canRaiseForApproval(status: string | null | undefined): boolean {
  return !SUBMIT_BLOCKED.has(paymentStatusKey(status));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-FINANCE-PAYMENTS-DETAIL-06: the one place a payment's display reference
 * is derived. A real reference (EFT ref, "PAY-ab12cd" already issued by the
 * API) is shown unchanged; a bare UUID collapses to PAY-<last 6 hex>.
 */
export function formatPaymentRef(ref: string | null | undefined, id?: string | null): string {
  const candidate = ref && ref.trim() !== "" ? ref.trim() : id ?? "";
  if (candidate === "") return "—";
  return UUID_RE.test(candidate) ? `PAY-${candidate.slice(-6).toUpperCase()}` : candidate;
}

/**
 * GAP-FINANCE-PAYMENTS-05: paise for sorting the register's Amount column.
 * Prefers the API's exact `amountMinor`; falls back to parsing the formatted
 * "₹1,00,00,000.00" display string (exact, no float). null when neither parses.
 */
export function paymentAmountMinor(p: { amountMinor?: string | undefined; amountDisplay: string }): bigint | null {
  const raw = p.amountMinor && /^\d+$/.test(p.amountMinor) ? p.amountMinor : parseRupeesToPaise(p.amountDisplay);
  return raw === null ? null : BigInt(raw);
}

/** True when the payment context carries at least one status-history event (kept out of page.tsx: the empty-vs-error guard). */
export function hasPaymentHistory<T extends { events: readonly unknown[] }>(ctx: T | null | undefined): ctx is T {
  return !!ctx && ctx.events.length > 0;
}
