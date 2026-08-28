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
import { createHash } from "node:crypto";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { parseMinor } from "@civitasone/schemas";

/** A filing id is deterministic on (tenant + case + type + idempotencyKey) so a
 *  redelivery of the SAME submit is idempotent end-to-end. idempotencyKey is
 *  normally hashFilingContent(...) below (a content hash of the submitted
 *  fields), so a genuine client retry - same case, same filing content - always
 *  derives the SAME key and therefore the same filingId, and dedupes via
 *  onConflictDoNothing; a caller with its own stronger idempotency key (e.g. a
 *  client-supplied request id) may still pass one directly instead. */
export function deriveFilingId(tenantId: string, caseId: string, filingType: string, idempotencyKey: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:filing:${caseId}:${filingType}:${idempotencyKey}`);
}

/**
 * Content-derived idempotency key for a filing submission - a SHA-256 hex digest
 * over every field that distinguishes one filing from another (the full
 * submitFilingBody shape: filingType, filingFeeMinor, courtFeeMinor). An identical
 * resubmission (a client double-click or a network-timeout retry) hashes to the
 * SAME key and therefore the same filingId, so it dedupes instead of creating a
 * second, fee-bearing row; a submission differing in any of these fields hashes
 * differently and persists as a distinct filing.
 *
 * The fields are combined via JSON.stringify (not a plain string join): each
 * element is individually quoted/escaped, so a filingType value can never shift
 * across a field boundary and collide with a differently-split input.
 *
 * DELIBERATE TRADEOFF (see PR description for the full writeup): this makes the id
 * purely CONTENT-based, with no random or time component. If a court practice ever
 * genuinely intends to submit two filings that are identical in type and fee on
 * purpose (e.g. resubmitting an amended-but-identically-priced document under the
 * same filingType), this hash cannot distinguish that from an accidental retry and
 * will collapse both into one row. filing is a backend-only, admin-driven flow (no
 * public/citizen-facing double-click surface), and silently double-charging a real
 * money fee on every timeout-retry is judged the worse failure mode to close, so
 * the tradeoff is accepted here rather than left as a fresh-random key.
 */
export function hashFilingContent(filingType: string, filingFeeMinor: bigint, courtFeeMinor: bigint): string {
  const content = JSON.stringify([filingType, filingFeeMinor.toString(), courtFeeMinor.toString()]);
  return createHash("sha256").update(content, "utf8").digest("hex");
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
