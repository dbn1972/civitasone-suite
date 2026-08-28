/**
 * certified-copy pure domain — the certified-copy state machine, id derivation,
 * and the fee computation helper (§30). No I/O — every function here is
 * deterministic and side-effect free so it is trivially unit-testable and safe to
 * call from both the command and consumer paths.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const COPY_STATUSES = [
  "requested",
  "fee_paid",
  "prepared",
  "issued",
  "rejected",
] as const;
export type CopyStatus = typeof COPY_STATUSES[number];

/**
 * Certified-copy lifecycle (§30): a requested copy is marked fee_paid once the
 * fee is settled, then prepared, then issued. A copy may be rejected from any
 * pre-terminal state. issued + rejected are terminal (no onward transition).
 */
const TRANSITIONS: Record<CopyStatus, CopyStatus[]> = {
  requested: ["fee_paid", "rejected"],
  fee_paid:  ["prepared", "rejected"],
  prepared:  ["issued", "rejected"],
  issued:    [],
  rejected:  [],
};

export function canTransition(from: CopyStatus, to: CopyStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: CopyStatus): void {
  if (!canTransition(from as CopyStatus, to)) {
    throw new Error(`INVALID_COPY_TRANSITION: cannot move certified copy from '${from}' to '${to}'`);
  }
}

/** Terminal states carry no onward transition (issued or rejected). */
export function isTerminal(status: CopyStatus): boolean {
  return status === "issued" || status === "rejected";
}

/**
 * A certified-copy id is deterministic on (tenant + case + requester + a
 * distinguishing seq/document-ref) so re-submitting the SAME request is
 * idempotent end-to-end.
 */
export function deriveCopyId(
  tenantId: string,
  caseId: string,
  requestedBy: string,
  seqOrDocRef: string,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:certified-copy:${caseId}:${requestedBy}:${seqOrDocRef}`,
  );
}

/**
 * Compute the certified-copy fee in BigInt PAISE: per-copy fee × number of copies,
 * plus a flat urgent surcharge when the request is urgent. Pure integer paise
 * arithmetic — no floating point, so money is exact.
 */
export function computeCopyFeeMinor(
  perCopyMinor: bigint,
  copies: number,
  urgent: boolean,
  urgentSurchargeMinor: bigint,
): bigint {
  const base = perCopyMinor * BigInt(copies);
  return urgent ? base + urgentSurchargeMinor : base;
}

/**
 * §30 payment-proof integrity: the requested → fee_paid transition MUST carry
 * a receipted amount (receiptMinor) that equals the server-authoritative
 * feeMinor recorded on the copy at request time. A mismatch means either the
 * wrong receipt was quoted or the payment was short/over — either way it is
 * NOT silently accepted. Both amounts are BigInt PAISE, so the comparison is
 * exact (no floating-point rounding).
 */
export function assertReceiptMatchesFee(feeMinor: bigint, receiptMinor: bigint): void {
  if (receiptMinor !== feeMinor) {
    throw new Error(
      `RECEIPT_AMOUNT_MISMATCH: receipted amount ${receiptMinor} does not match the fee ${feeMinor}`,
    );
  }
}

/**
 * Parse the payment-proof `receiptMinor` wire value (string | number) to a
 * non-negative integer PAISE (BigInt). Pure — shared by the command layer's
 * synchronous pre-check (commands.ts, so a bad receipt gets an immediate 4xx
 * instead of a silent async dead-letter) and the consumer's own authoritative
 * check (consumer.ts). Each call site wraps the plain `Error` this throws in
 * whatever exception type fits its layer (HttpError vs NonRetryableError).
 */
export function parseReceiptMinor(value: string | number | undefined): bigint {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(
    `INVALID_RECEIPT_AMOUNT: receiptMinor must be a non-negative integer paise amount, got ${JSON.stringify(value)}`,
  );
}

/**
 * The full set of checks a certified-copy transition must pass before it is
 * applied (§30) — shared VERBATIM by the command layer's synchronous
 * pre-check (commands.ts, so a caller gets an honest 4xx instead of a `202`
 * that later silently dead-letters) and the consumer's own authoritative,
 * transactional check (consumer.ts), so the two can never silently drift
 * apart on a future edit to either one.
 *
 * Already being AT the target status is treated as a redelivery/idempotent-
 * retry-safe no-op: this returns normally (no `receiptMinor`) WITHOUT running
 * the version/transition/fee checks below — exactly like a transition that
 * has already completed. Callers still decide for themselves whether to skip
 * their own side effect (publish / write) in that case; the consumer in
 * particular MUST still check this itself before writing, since running its
 * write with a since-stale `expectedVersion` would otherwise raise a
 * spurious version conflict for what should be a harmless no-op.
 *
 * Every other failure throws a plain `Error` with a stable `CODE:` message
 * prefix (`VERSION_CONFLICT`, `INVALID_COPY_TRANSITION`,
 * `INVALID_RECEIPT_AMOUNT`, or `RECEIPT_AMOUNT_MISMATCH`); each call site
 * wraps it in whatever exception type fits its own layer (HttpError vs
 * NonRetryableError).
 *
 * When `target === "fee_paid"` and every check passes, the parsed
 * `receiptMinor` is returned so a caller that goes on to WRITE it (the
 * consumer) does not have to parse it a second time.
 */
export function assertLegalCopyTransition(input: {
  copyId: string;
  currentStatus: string;
  currentVersion: number;
  currentFeeMinor: bigint;
  target: CopyStatus;
  expectedVersion: number;
  receiptMinor?: string | number;
}): { receiptMinor?: bigint } {
  const { copyId, currentStatus, currentVersion, currentFeeMinor, target, expectedVersion, receiptMinor } = input;

  if (currentStatus === target) return {}; // already done — redelivery/retry-safe no-op

  if (currentVersion !== expectedVersion) {
    throw new Error(
      `VERSION_CONFLICT: certified copy ${copyId} expected v${expectedVersion}, found v${currentVersion}`,
    );
  }
  assertTransition(currentStatus, target);

  if (target !== "fee_paid") return {};
  const parsedReceiptMinor = parseReceiptMinor(receiptMinor);
  assertReceiptMatchesFee(currentFeeMinor, parsedReceiptMinor);
  return { receiptMinor: parsedReceiptMinor };
}
