/**
 * filing pure domain — filing id derivation and the money-conservation guard
 * (§12 filing / §31 court fee). No I/O.
 *
 * Money: filingFeeMinor/courtFeeMinor are BigInt PAISE end-to-end (never a JS
 * number) so amounts never lose precision through the JS safe-integer range.
 * parseMinor (from @civitasone/schemas) decodes a string | number | bigint
 * config/wire value to an exact bigint, rejecting unsafe (already-lossy) JSON
 * numbers — see packages/schemas/src/money.ts.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { parseMinor } from "@civitasone/schemas";

/** A filing id is deterministic on (tenant + case + type + idempotencyKey) so a
 *  redelivery of the SAME submit is idempotent end-to-end; a case may have many
 *  filings, so the caller supplies a fresh idempotencyKey per submit. */
export function deriveFilingId(tenantId: string, caseId: string, filingType: string, idempotencyKey: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:filing:${caseId}:${filingType}:${idempotencyKey}`);
}

/** Money-conservation guard: a fee (in PAISE) must be a non-negative bigint. */
export function assertNonNegativeFee(minor: bigint): void {
  if (minor < 0n) {
    throw new Error(`INVALID_FEE: fee must be a non-negative integer paise amount, got ${minor}`);
  }
}

/** The shape of a fee_schedule config value (§47) — authoritative fees in paise. */
export type FeeAmounts = { filingFeeMinor: bigint; courtFeeMinor: bigint };

/**
 * Resolve the AUTHORITATIVE fees for a filing (§31). If the tenant has a
 * fee_schedule config entry for this filing type, the SERVER-configured amounts
 * are used — client-supplied amounts cannot lower or tamper the fee; a malformed
 * schedule value (non-numeric, non-integer, or an already-lossy unsafe JSON
 * number) is a poison message. With no schedule configured, fall back to the
 * client-supplied amounts (backward compatible).
 */
export function resolveFees(
  configValue: unknown,
  fallback: FeeAmounts,
): { filingFeeMinor: bigint; courtFeeMinor: bigint; source: "config" | "client" } {
  if (configValue === undefined || configValue === null) {
    return { ...fallback, source: "client" };
  }
  const v = configValue as Record<string, unknown>;
  let filingFeeMinor: bigint;
  let courtFeeMinor: bigint;
  try {
    filingFeeMinor = parseMinor(v.filingFeeMinor as string | number | bigint);
    courtFeeMinor = parseMinor(v.courtFeeMinor as string | number | bigint);
  } catch {
    throw new Error(`INVALID_FEE_SCHEDULE: fee_schedule value must be non-negative integer paise { filingFeeMinor, courtFeeMinor }, got ${JSON.stringify(configValue)}`);
  }
  if (filingFeeMinor < 0n || courtFeeMinor < 0n) {
    throw new Error(`INVALID_FEE_SCHEDULE: fee_schedule value must be non-negative integer paise { filingFeeMinor, courtFeeMinor }, got ${JSON.stringify(configValue)}`);
  }
  return { filingFeeMinor, courtFeeMinor, source: "config" };
}
