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
