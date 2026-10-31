/**
 * F92 (UAT T6-04): the amount carried by billing.invoice.paid.
 *
 * The producer is the contract: billing-service emits `{ invoiceId, totalMinor }` from both of its settle paths
 * (payments/consumer.ts and invoice-ops/consumer.ts), the same field name billing.invoice.issued uses. finance read
 * `paidMinor`, a field no producer has ever sent, so every paid invoice died on BigInt(undefined) and dead-lettered.
 * `totalMinor` is canonical; `paidMinor` is still accepted so nothing already queued under the old reading is lost.
 * A payload with neither is a contract violation that no retry can fix (returns null; the caller dead-letters it).
 *
 * No imports on purpose: tests/contract/billing-invoice-paid.contract.test.ts loads this from the repo root.
 */
export function invoicePaidAmountMinor(payload: Record<string, unknown>): bigint | null {
  const raw = payload.totalMinor ?? payload.paidMinor;
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return BigInt(raw);
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return BigInt(raw.trim());
  return null;
}
