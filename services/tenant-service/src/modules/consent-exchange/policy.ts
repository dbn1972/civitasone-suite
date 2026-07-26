/**
 * SVC-150 — consent-fetch enforcement policy (pure, side-effect free).
 *
 * A department may fetch consented data ONLY when a valid, active, in-window,
 * purpose-matching consent artefact covers every requested data-category. This
 * is the single decision point the fetch path consults; keeping it pure makes
 * the deny reasons exhaustively unit-testable and reused by the reason ledger.
 *
 * References `packages/data-governance` `ConsentDenied` semantics: a denial is
 * a first-class, explainable outcome rather than a thrown opaque error.
 */
import type { ConsentArtefactRow } from "./schema.js";

export type FetchDenyReason =
  | "NOT_GRANTED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "NOT_ACTIVE"
  | "WINDOW_NOT_STARTED"
  | "WINDOW_EXPIRED"
  | "PURPOSE_MISMATCH"
  | "CATEGORY_OUT_OF_SCOPE"
  | "ALREADY_FETCHED";

export interface FetchRequest {
  purposeKey: string;
  categories: string[];
}

export type FetchDecision =
  | { allowed: true }
  | { allowed: false; reason: FetchDenyReason };

/**
 * Decide whether `req` may be served against consent `artefact` at time `now`.
 * Ordering matters: terminal states (revoked/denied/expired) are reported
 * before window/scope checks so the ledger records the most specific cause.
 */
export function evaluateFetch(artefact: ConsentArtefactRow, req: FetchRequest, now: Date): FetchDecision {
  switch (artefact.status) {
    case "revoked": return { allowed: false, reason: "REVOKED" };
    case "denied":  return { allowed: false, reason: "DENIED" };
    case "expired": return { allowed: false, reason: "EXPIRED" };
    case "requested":
    case "granted": return { allowed: false, reason: "NOT_GRANTED" };
    case "active":  break;
    default:        return { allowed: false, reason: "NOT_ACTIVE" };
  }

  if (now < artefact.validFrom) return { allowed: false, reason: "WINDOW_NOT_STARTED" };
  if (now > artefact.validTo)   return { allowed: false, reason: "WINDOW_EXPIRED" };

  if (req.purposeKey !== artefact.purposeKey) return { allowed: false, reason: "PURPOSE_MISMATCH" };

  const granted = new Set(artefact.dataCategories ?? []);
  if (req.categories.length === 0 || !req.categories.every((c) => granted.has(c))) {
    return { allowed: false, reason: "CATEGORY_OUT_OF_SCOPE" };
  }

  if (artefact.frequency === "one-time" && artefact.fetchCount >= 1) {
    return { allowed: false, reason: "ALREADY_FETCHED" };
  }

  return { allowed: true };
}
