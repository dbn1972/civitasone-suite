/**
 * identity/domain.ts — Identity matching logic.
 * Deterministic: exact match on normalized identifier.
 * Probabilistic: fuzzy name + partial phone matching (routes ambiguous to steward).
 */
import { createHash } from "node:crypto";

/**
 * Normalize an identifier value for consistent matching.
 * - Email: lowercase, trim
 * - Phone: strip non-digits, keep last 10
 * - Default: trim + lowercase
 */
export function normalizeIdentifier(type: string, value: string): string {
  const trimmed = value.trim();
  switch (type) {
    case "email":
      return trimmed.toLowerCase();
    case "phone": {
      const digits = trimmed.replace(/\D/g, "");
      return digits.length > 10 ? digits.slice(-10) : digits;
    }
    default:
      return trimmed.toLowerCase();
  }
}

/**
 * Create a hash of the normalized identifier for indexed lookup.
 * Uses SHA-256 for fast, collision-resistant hashing.
 */
export function hashIdentifier(type: string, value: string): string {
  const normalized = normalizeIdentifier(type, value);
  return createHash("sha256").update(`${type}:${normalized}`).digest("hex");
}

export type MatchResult = {
  profileId: string;
  confidence: number;
  matchType: "deterministic" | "probabilistic";
};

export type ResolutionOutcome =
  | { status: "matched"; profileId: string; confidence: number }
  | { status: "created"; profileId: string; confidence: number }
  | { status: "ambiguous"; candidates: Array<{ profileId: string; confidence: number }> };

/**
 * Compute confidence for a deterministic (exact) match.
 * Returns 1.0 for email/externalId, 0.95 for phone (since phone can be reused).
 */
export function deterministicConfidence(identifierType: string): number {
  switch (identifierType) {
    case "email":
    case "externalId":
      return 1.0;
    case "phone":
      return 0.95;
    default:
      return 0.9;
  }
}

/**
 * Compute a fuzzy confidence score for name-based matching.
 * Uses a simple Levenshtein-like ratio (for basic probabilistic matching).
 */
export function fuzzyNameConfidence(name1: string, name2: string): number {
  const a = name1.toLowerCase().trim();
  const b = name2.toLowerCase().trim();
  if (a === b) return 0.9;
  // Simple token overlap approach
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 0;
  const jaccard = intersection.length / union.size;
  return Math.round(jaccard * 0.8 * 10000) / 10000;
}

/**
 * Threshold for routing to steward queue.
 * Below this confidence, the match is "ambiguous" and requires human review.
 */
export const AMBIGUITY_THRESHOLD = 0.7;

/**
 * Threshold for auto-matching without steward review.
 */
export const AUTO_MATCH_THRESHOLD = 0.9;
