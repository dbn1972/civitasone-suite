/**
 * identity/phonetic-domain.ts — CR-CDP-02 phonetic / approximate name matching (PURE).
 *
 * Deterministic hash matching (domain.ts) needs an identical identifier, and the
 * probabilistic layer (probabilistic-domain.ts) only scores whole-token overlap. Neither
 * catches the failure that actually splits Indian golden profiles: the same name spelled
 * differently by two clerks — "Rajesh Kumar" / "Rajesh Kumaar", "Krishnan" / "Krishnnan",
 * "Sanjay" / "Sunjay". Those sound alike and read alike but share no exact token.
 *
 * Scoring composes three independent signals so no single one can carry a match:
 *   Soundex agreement per token  — catches transliteration variance
 *   Jaro-Winkler on the canonical form — catches typos, weighted to the prefix
 *   Levenshtein ratio            — penalises length divergence the other two tolerate
 *
 * `soundex` and `jaroWinkler` are imported from resolution-domain.ts rather than
 * reimplemented: two copies of a phonetic coder drift, and a name that matches on one
 * code and not the other is the hardest class of identity bug to diagnose.
 *
 * Every function here is pure and total, so the matcher is unit-testable without a
 * database. Postgres involvement is limited to *retrieving* a candidate window
 * (pg_trgm), never to scoring — a score computed in SQL could not be reproduced in a
 * test, and a survivorship decision that cannot be reproduced cannot be audited.
 */
import { soundex, jaroWinkler } from "./resolution-domain.js";

/**
 * Honorifics and salutations carry no identifying information but wreck token overlap:
 * "Shri Rajesh Kumar" vs "Rajesh Kumar" would otherwise lose a third of its tokens.
 */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "master", "dr", "prof", "shri", "sri", "smt", "shrimati",
  "kumari", "kum", "md", "late", "sh",
]);

/** Generational and ordering suffixes, dropped for the same reason as honorifics. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** At or above this score two names are the same person for auto-link purposes. */
export const PHONETIC_MATCH_THRESHOLD = 0.88;
/** At or above this score a steward decides; below it, the pair is not a match. */
export const PHONETIC_REVIEW_THRESHOLD = 0.7;

export type PhoneticClassification = "match" | "review" | "no_match";

/** Signal weights. They total 1.0, so a perfect agreement on all three scores exactly 1. */
export const PHONETIC_WEIGHTS = {
  jaroWinkler: 0.45,
  phonetic: 0.35,
  edit: 0.2,
} as const;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Canonical form of a name: diacritics folded, honorifics and suffixes removed,
 * everything but letters and single spaces discarded.
 *
 * Digits and punctuation are dropped rather than kept, because they are always noise in
 * a person name field ("Rajesh Kumar (2)", "Rajesh-Kumar", "RAJESH KUMAR 9876543210").
 */
export function normalizeName(raw: string): string {
  const folded = raw
    .normalize("NFD")
    // Strip combining marks left behind by NFD (é → e, ā → a).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ");

  const tokens = folded
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !HONORIFICS.has(t) && !SUFFIXES.has(t));

  return tokens.join(" ");
}

/** Canonical tokens of a name, in input order. */
export function nameTokens(raw: string): string[] {
  const normalized = normalizeName(raw);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * Order-insensitive canonical form. "Kumar Rajesh" and "Rajesh Kumar" are the same
 * person recorded by two systems that disagree about which field is the surname.
 */
export function canonicalName(raw: string): string {
  return [...nameTokens(raw)].sort().join(" ");
}

/**
 * The set of Soundex codes for a name's tokens, sorted and deduplicated.
 *
 * This is the value stored on the profile and indexed, so a candidate lookup is an
 * equality/overlap test in Postgres rather than a scan. Sorting makes it stable under
 * name reordering; deduplicating stops a repeated token inflating overlap.
 */
export function phoneticKey(raw: string): string {
  const codes = [...new Set(nameTokens(raw).map((t) => soundex(t)))].sort();
  return codes.join(" ");
}

/** Levenshtein edit distance. Iterative two-row DP: O(min(a,b)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length] ?? 0;
}

/** 1 - normalised edit distance, in [0, 1]. Two empty strings are identical. */
export function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return round4(1 - levenshtein(a, b) / longest);
}

/** Jaccard overlap of the two names' Soundex code sets, in [0, 1]. */
export function phoneticOverlap(a: string, b: string): number {
  const ca = new Set(nameTokens(a).map((t) => soundex(t)));
  const cb = new Set(nameTokens(b).map((t) => soundex(t)));
  if (ca.size === 0 || cb.size === 0) return 0;
  let shared = 0;
  for (const code of ca) if (cb.has(code)) shared++;
  const union = new Set([...ca, ...cb]).size;
  return round4(shared / union);
}

export interface NameMatchScore {
  score: number;
  classification: PhoneticClassification;
  /** Identical after normalisation (case, diacritics, honorifics). */
  exact: boolean;
  /** Identical once tokens are sorted — a first-name/surname swap. */
  orderInsensitiveExact: boolean;
  jaroWinkler: number;
  phonetic: number;
  edit: number;
}

/**
 * Score how likely two names are the same person, in [0, 1].
 *
 * Comparisons run on the order-insensitive canonical form, so a swapped surname does not
 * depress the string signals. An empty canonical form on either side scores 0: a name
 * field of "..." or "12345" must never match anything, and returning a small non-zero
 * score for it would let noise accumulate into a review-band candidate.
 */
export function scoreNameMatch(a: string, b: string): NameMatchScore {
  const na = normalizeName(a);
  const nb = normalizeName(b);

  if (na === "" || nb === "") {
    return {
      score: 0,
      classification: "no_match",
      exact: false,
      orderInsensitiveExact: false,
      jaroWinkler: 0,
      phonetic: 0,
      edit: 0,
    };
  }

  const ca = canonicalName(a);
  const cb = canonicalName(b);

  const jw = round4(jaroWinkler(ca, cb));
  const phon = phoneticOverlap(a, b);
  const edit = levenshteinRatio(ca, cb);

  if (na === nb) {
    return { score: 1, classification: "match", exact: true, orderInsensitiveExact: true, jaroWinkler: jw, phonetic: phon, edit };
  }
  if (ca === cb) {
    // Not 1.0: the two systems disagree about field order, which is worth surfacing.
    return { score: 0.98, classification: "match", exact: false, orderInsensitiveExact: true, jaroWinkler: jw, phonetic: phon, edit };
  }

  const score = round4(
    PHONETIC_WEIGHTS.jaroWinkler * jw + PHONETIC_WEIGHTS.phonetic * phon + PHONETIC_WEIGHTS.edit * edit,
  );

  return {
    score,
    classification: classifyNameScore(score),
    exact: false,
    orderInsensitiveExact: false,
    jaroWinkler: jw,
    phonetic: phon,
    edit,
  };
}

/** Map a score onto the auto-link / steward-review / discard bands. */
export function classifyNameScore(score: number): PhoneticClassification {
  if (score >= PHONETIC_MATCH_THRESHOLD) return "match";
  if (score >= PHONETIC_REVIEW_THRESHOLD) return "review";
  return "no_match";
}

export interface RankedNameMatch {
  profileId: string;
  score: number;
  classification: PhoneticClassification;
  exact: boolean;
  orderInsensitiveExact: boolean;
  signals: { jaroWinkler: number; phonetic: number; edit: number };
}

/**
 * Score a candidate window and return it best-first.
 *
 * `no_match` candidates are dropped — showing a steward a pair the matcher rejected
 * invites a merge the model explicitly refused. Ties break on profileId so the ordering
 * is stable across runs and across database read orders.
 */
export function rankNameMatches(
  name: string,
  candidates: Array<{ profileId: string; name: string }>,
  limit: number,
): RankedNameMatch[] {
  return candidates
    .map((c) => {
      const s = scoreNameMatch(name, c.name);
      return {
        profileId: c.profileId,
        score: s.score,
        classification: s.classification,
        exact: s.exact,
        orderInsensitiveExact: s.orderInsensitiveExact,
        signals: { jaroWinkler: s.jaroWinkler, phonetic: s.phonetic, edit: s.edit },
      };
    })
    .filter((c) => c.classification !== "no_match")
    .sort((a, b) => (b.score - a.score) || a.profileId.localeCompare(b.profileId))
    .slice(0, Math.max(0, limit));
}
