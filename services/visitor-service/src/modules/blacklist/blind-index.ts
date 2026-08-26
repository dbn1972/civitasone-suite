/**
 * visitor-service: blacklist/watchlist blind-index helper.
 *
 * Thin, module-specific wrapper around the shared deterministic HMAC blind
 * index (`shared/pii-crypto.ts#blindIndex`) for identity-document screening
 * lookups against `visitor.blacklist_entries` / `visitor.watchlist_entries`
 * (migration 0003's `identity_doc_hash` columns).
 *
 * Keeping this as a dedicated module (rather than importing `blindIndex`
 * directly everywhere) gives the blacklist/watchlist screening use case a
 * single, documented seam: normalization rules specific to identity
 * documents (doc type + doc number) live here, while the underlying keyed
 * HMAC primitive and key management stay in shared/pii-crypto.ts.
 */
import { blindIndex } from "../../shared/pii-crypto.js";

/**
 * Compute the blind index (deterministic HMAC-SHA256 hex digest) for an
 * identity document, used to populate / query `identity_doc_hash` on
 * blacklist and watchlist entries without ever storing or matching on the
 * cleartext document number.
 *
 * The optional `docType` is folded into the hashed value so the same raw
 * document number under different document types (e.g. "aadhaar" vs
 * "passport") produces distinct hashes, avoiding false-positive screening
 * matches across document types.
 *
 * `docNumber` is normalized (whitespace stripped, upper-cased) before
 * hashing so the SAME physical document hashes identically no matter how it
 * was captured — e.g. a receptionist's manual "1234 5678 9012" entry at
 * visit-request time vs. an OCR extraction's "123456789012" at scan time.
 * Callers MUST route through this function rather than normalizing
 * independently at each call site — that is exactly how this gap happened:
 * `docType` was normalized here, but `docNumber` was hashed verbatim, so the
 * DPDP purge worker's `identityDocHash`-based match between a visit
 * request's identityDocRef and an ocr_results row silently missed any pair
 * that differed only in spacing/case (see purge-worker.ts's ocr_results
 * cascade).
 */
export function identityDocHash(docNumber: string, docType?: string | null): string {
  const normalizedType = docType ? docType.trim().toLowerCase() : "";
  // Aadhaar/PAN/DL/Voter-ID numbers are alphanumeric with no case-sensitive
  // meaning — strip all whitespace and upper-case so two independently
  // captured renderings of the same physical document (different spacing,
  // different case) always produce the same hash.
  const normalizedNumber = docNumber.replace(/\s+/g, "").toUpperCase();
  return blindIndex(`${normalizedType}:${normalizedNumber}`);
}

/** Re-exported for callers that need the raw primitive (e.g. name-based screening). */
export { blindIndex };
