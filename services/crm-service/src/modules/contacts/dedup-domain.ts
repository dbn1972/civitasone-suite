/**
 * Configurable duplicate-detection scoring (DQ-001).
 *
 * Pure functions only: given a candidate record, a set of existing records and
 * the tenant's configured matching rules, rank the existing records by how
 * strongly they duplicate the candidate. No DB, no I/O — unit-testable.
 */
import {
  normalizePhone,
  normalizeEmail,
  matchScore,
  normalizeGstin,
  normalizePan,
} from "./identity-domain.js";

/** Fields a dedup rule can match on. */
export type DedupField = "email" | "phone" | "gstin" | "pan" | "name" | "company";

export type MatchType = "exact" | "fuzzy";

export interface DedupRule {
  field: DedupField;
  matchType: MatchType;
  /** Points contributed to the score when this rule matches (0-100). */
  weight: number;
  /** For fuzzy rules: the minimum token-overlap score (0-100) to count as a match. */
  threshold: number;
  enabled: boolean;
}

/** The subset of contact attributes dedup cares about. */
export interface DedupFields {
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  pan?: string | null;
  name?: string | null;
  company?: string | null;
}

export interface DedupCandidate extends DedupFields {
  id: string;
}

export interface DedupMatch {
  id: string;
  matchedFields: DedupField[];
  score: number;
}

/** Sensible per-tenant defaults, seeded lazily the first time rules are read. */
export const DEFAULT_DEDUP_RULES: readonly DedupRule[] = [
  { field: "email", matchType: "exact", weight: 40, threshold: 100, enabled: true },
  { field: "phone", matchType: "exact", weight: 30, threshold: 100, enabled: true },
  { field: "gstin", matchType: "exact", weight: 50, threshold: 100, enabled: true },
  { field: "pan", matchType: "exact", weight: 40, threshold: 100, enabled: true },
  { field: "name", matchType: "fuzzy", weight: 20, threshold: 60, enabled: true },
  { field: "company", matchType: "fuzzy", weight: 15, threshold: 60, enabled: true },
] as const;

/** Does a single rule match between the candidate and an existing record? */
function fieldMatches(
  rule: DedupRule,
  candidate: DedupFields,
  other: DedupFields,
): boolean {
  const a = candidate[rule.field];
  const b = other[rule.field];
  if (a == null || b == null || a === "" || b === "") return false;

  if (rule.matchType === "exact") {
    switch (rule.field) {
      case "email":
        return normalizeEmail(String(a)) === normalizeEmail(String(b));
      case "phone": {
        // Compare the trailing 10-digit subscriber number so a +91-prefixed
        // value and a bare number are recognised as the same phone.
        const pa = normalizePhone(String(a)).replace(/^\+/, "");
        const pb = normalizePhone(String(b)).replace(/^\+/, "");
        return (pa.length >= 10 ? pa.slice(-10) : pa) === (pb.length >= 10 ? pb.slice(-10) : pb);
      }
      case "gstin":
        return normalizeGstin(String(a)) === normalizeGstin(String(b));
      case "pan":
        return normalizePan(String(a)) === normalizePan(String(b));
      default:
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }
  }
  // fuzzy — token overlap over the configured threshold
  return matchScore(String(a), String(b)) >= rule.threshold;
}

/**
 * Score one existing record against the candidate under the given rules.
 * Score is the sum of matched rule weights, capped at 100.
 */
export function scoreCandidate(
  candidate: DedupFields,
  other: DedupCandidate,
  rules: readonly DedupRule[],
): DedupMatch {
  const matchedFields: DedupField[] = [];
  let score = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (fieldMatches(rule, candidate, other)) {
      matchedFields.push(rule.field);
      score += rule.weight;
    }
  }
  return { id: other.id, matchedFields, score: Math.min(score, 100) };
}

/**
 * Rank existing records as potential duplicates of the candidate.
 * Returns only records with score > 0, highest score first (id tiebreak for
 * determinism), truncated to `limit`.
 */
export function rankDuplicates(
  candidate: DedupFields,
  others: readonly DedupCandidate[],
  rules: readonly DedupRule[],
  limit = 10,
): DedupMatch[] {
  const scored = others
    .map((o) => scoreCandidate(candidate, o, rules))
    .filter((m) => m.score > 0);
  scored.sort((x, y) => (y.score - x.score) || x.id.localeCompare(y.id));
  return scored.slice(0, limit);
}
