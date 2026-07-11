/**
 * filing pure domain — filing id derivation and the money-conservation guard
 * (§12 filing / §31 court fee). No I/O.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/** A filing id is deterministic on (tenant + case + type + idempotencyKey) so a
 *  redelivery of the SAME submit is idempotent end-to-end; a case may have many
 *  filings, so the caller supplies a fresh idempotencyKey per submit. */
export function deriveFilingId(tenantId: string, caseId: string, filingType: string, idempotencyKey: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:filing:${caseId}:${filingType}:${idempotencyKey}`);
}

/** Money-conservation guard: a fee (in PAISE) must be a non-negative integer. */
export function assertNonNegativeFee(minor: number): void {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new Error(`INVALID_FEE: fee must be a non-negative integer paise amount, got ${minor}`);
  }
}
