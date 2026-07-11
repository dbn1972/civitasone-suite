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

/** The shape of a fee_schedule config value (§47) — authoritative fees in paise. */
export type FeeAmounts = { filingFeeMinor: number; courtFeeMinor: number };

/**
 * Resolve the AUTHORITATIVE fees for a filing (§31). If the tenant has a
 * fee_schedule config entry for this filing type, the SERVER-configured amounts
 * are used — client-supplied amounts cannot lower or tamper the fee; a malformed
 * schedule value is a poison message. With no schedule configured, fall back to
 * the client-supplied amounts (backward compatible).
 */
export function resolveFees(
  configValue: unknown,
  fallback: FeeAmounts,
): { filingFeeMinor: number; courtFeeMinor: number; source: "config" | "client" } {
  if (configValue === undefined || configValue === null) {
    return { ...fallback, source: "client" };
  }
  const v = configValue as Record<string, unknown>;
  const f = v.filingFeeMinor;
  const c = v.courtFeeMinor;
  if (!Number.isInteger(f) || (f as number) < 0 || !Number.isInteger(c) || (c as number) < 0) {
    throw new Error(`INVALID_FEE_SCHEDULE: fee_schedule value must be non-negative integer paise { filingFeeMinor, courtFeeMinor }, got ${JSON.stringify(configValue)}`);
  }
  return { filingFeeMinor: f as number, courtFeeMinor: c as number, source: "config" };
}
