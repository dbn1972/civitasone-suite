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
 */
export function identityDocHash(docNumber: string, docType?: string | null): string {
  const normalizedType = docType ? docType.trim().toLowerCase() : "";
  return blindIndex(`${normalizedType}:${docNumber}`);
}

/** Re-exported for callers that need the raw primitive (e.g. name-based screening). */
export { blindIndex };
