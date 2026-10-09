/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — pure computation of flagged duplicate PAIRS
 * from the tenant's active contacts.
 *
 * The pre-save `duplicate-check` scorer ranks ONE candidate against the registry.
 * The post-save review screen (/crm/dedup-candidates) instead needs the full set
 * of near-duplicate PAIRS already in the registry. This module computes those
 * pairs by scoring every unordered contact pair with the SAME configured rules
 * (`scoreCandidate`), so the review screen and the pre-save check agree on what
 * counts as a duplicate. No DB, no I/O — unit-testable.
 */
import { scoreCandidate, type DedupRule, type DedupCandidate, type DedupField } from "./dedup-domain.js";

/** A contact snapshot carried to the review UI (id + the comparison fields). */
export interface DedupPairContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  lastActivity: string | null;
}

export interface DedupCandidatePair {
  /** Deterministic, order-independent id for the pair (sorted contact ids). */
  pairId: string;
  /** Confidence the two contacts are the same person, 0-100. */
  confidence: number;
  matchedFields: DedupField[];
  left: DedupPairContact;
  right: DedupPairContact;
}

/** Order-independent pair id so dismiss(A,B) and a later compute(B,A) agree. */
export function pairIdOf(a: string, b: string): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

/** The contact fields the pair computation needs (superset of DedupCandidate). */
export interface DedupPairInput extends DedupCandidate {
  lastActivity?: string | null;
}

/**
 * Compute near-duplicate pairs over a contact set under the tenant's rules.
 * Only pairs scoring at/above `minConfidence` are returned, highest first, with
 * a deterministic id tiebreak. `dismissed` pair ids are excluded.
 */
export function computeDedupPairs(
  contacts: readonly DedupPairInput[],
  rules: readonly DedupRule[],
  opts: { minConfidence?: number; dismissed?: ReadonlySet<string>; limit?: number } = {},
): DedupCandidatePair[] {
  const minConfidence = opts.minConfidence ?? 1;
  const dismissed = opts.dismissed ?? new Set<string>();
  const limit = opts.limit ?? 200;

  const pairs: DedupCandidatePair[] = [];
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]!;
      const b = contacts[j]!;
      const pairId = pairIdOf(a.id, b.id);
      if (dismissed.has(pairId)) continue;
      // Symmetric scoring: score b against a. scoreCandidate is symmetric for
      // the exact/fuzzy field comparisons used here.
      const m = scoreCandidate(a, b, rules);
      if (m.score < minConfidence) continue;
      const [left, right] = a.id <= b.id ? [a, b] : [b, a];
      pairs.push({
        pairId,
        confidence: m.score,
        matchedFields: m.matchedFields,
        left: snapshot(left),
        right: snapshot(right),
      });
    }
  }
  pairs.sort((x, y) => (y.confidence - x.confidence) || x.pairId.localeCompare(y.pairId));
  return pairs.slice(0, limit);
}

function snapshot(c: DedupPairInput): DedupPairContact {
  return {
    id: c.id,
    name: c.name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    company: c.company ?? null,
    lastActivity: c.lastActivity ?? null,
  };
}
