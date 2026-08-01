/**
 * identity/probabilistic-domain.ts — CDP-002 probabilistic identity layer (PURE).
 *
 * Deterministic hash matching (see domain.ts) only fires when two records share an
 * identical identifier. Real citizen data rarely does: a phone is re-keyed, an email is
 * a work address on one record and personal on another. This layer scores partial
 * agreement so those records reach a steward instead of silently forking into two
 * golden profiles.
 *
 * Weights are the agreement value of each feature, not a probability:
 *   email 0.50 — near-unique, rarely shared
 *   phone 0.30 — strong, but shared within a household and re-issued by operators
 *   name  0.15 — token overlap only; Indian name ordering and transliteration vary
 *   city  0.05 — weak on its own, useful as a tie-breaker
 * They total 1.0, so a record agreeing on everything scores exactly 1.
 */

export interface CandidateAttributes {
  email?: string | undefined;
  phone?: string | undefined;
  name?: string | undefined;
  city?: string | undefined;
}

export const FEATURE_WEIGHTS = {
  email: 0.5,
  phone: 0.3,
  name: 0.15,
  city: 0.05,
} as const;

/** At or above this score the pair is the same person; below REVIEW it is not a match. */
export const MATCH_THRESHOLD = 0.85;
/** At or above this score a human steward decides. */
export const REVIEW_THRESHOLD = 0.6;

export type MatchClassification = "match" | "review" | "no_match";

/** Round to 4 dp so a score is stable to compare and to serialise. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Phones are compared on their last 10 digits: country prefixes and separators vary. */
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function nameTokens(value: string): string[] {
  return normalizeText(value)
    .split(/[\s.,]+/)
    .filter((t) => t.length > 0);
}

/**
 * Jaccard overlap of name tokens. Order-insensitive on purpose: "Kumar Rajesh" and
 * "Rajesh Kumar" are the same name written by two different systems.
 */
export function nameTokenOverlap(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : shared / union;
}

/**
 * Score how strongly two attribute sets describe the same person, in [0, 1].
 *
 * Only features present on BOTH sides contribute, and the score is divided by the
 * weight actually compared. Absence is not disagreement: a record that happens to carry
 * no phone must not be penalised against one that does — otherwise sparse records could
 * never reach the review band at all.
 */
export function scoreCandidate(a: CandidateAttributes, b: CandidateAttributes): number {
  let comparedWeight = 0;
  let agreedWeight = 0;

  const bothPresent = (x: string | undefined, y: string | undefined): boolean =>
    x !== undefined && y !== undefined && x.trim() !== "" && y.trim() !== "";

  if (bothPresent(a.email, b.email)) {
    comparedWeight += FEATURE_WEIGHTS.email;
    if (normalizeText(a.email as string) === normalizeText(b.email as string)) {
      agreedWeight += FEATURE_WEIGHTS.email;
    }
  }

  if (bothPresent(a.phone, b.phone)) {
    comparedWeight += FEATURE_WEIGHTS.phone;
    const pa = normalizePhone(a.phone as string);
    const pb = normalizePhone(b.phone as string);
    if (pa !== "" && pa === pb) {
      agreedWeight += FEATURE_WEIGHTS.phone;
    }
  }

  if (bothPresent(a.name, b.name)) {
    comparedWeight += FEATURE_WEIGHTS.name;
    // Names get partial credit — a shared surname is weak evidence, not none.
    agreedWeight += FEATURE_WEIGHTS.name * nameTokenOverlap(a.name as string, b.name as string);
  }

  if (bothPresent(a.city, b.city)) {
    comparedWeight += FEATURE_WEIGHTS.city;
    if (normalizeText(a.city as string) === normalizeText(b.city as string)) {
      agreedWeight += FEATURE_WEIGHTS.city;
    }
  }

  if (comparedWeight === 0) return 0;
  return round4(agreedWeight / comparedWeight);
}

/** Map a score onto the auto-merge / steward-review / discard bands. */
export function classify(score: number): MatchClassification {
  if (score >= MATCH_THRESHOLD) return "match";
  if (score >= REVIEW_THRESHOLD) return "review";
  return "no_match";
}

export interface ScoredCandidate {
  profileId: string;
  score: number;
  classification: MatchClassification;
}

/**
 * Score every candidate against the incoming attributes and return them best-first.
 * `no_match` candidates are dropped: surfacing them would invite a steward to approve a
 * merge the model explicitly rejected.
 */
export function rankCandidates(
  attributes: CandidateAttributes,
  candidates: Array<{ profileId: string; attributes: CandidateAttributes }>,
  limit: number,
): ScoredCandidate[] {
  return candidates
    .map((c) => {
      const score = scoreCandidate(attributes, c.attributes);
      return { profileId: c.profileId, score, classification: classify(score) };
    })
    .filter((c) => c.classification !== "no_match")
    .sort((a, b) => (b.score - a.score) || a.profileId.localeCompare(b.profileId))
    .slice(0, limit);
}

/**
 * Project an arbitrary profile attribute bag onto the four scored features.
 * Non-string values are ignored rather than coerced: `String(someObject)` would produce
 * "[object Object]" on both sides and score as agreement.
 */
export function toCandidateAttributes(attributes: Record<string, unknown>): CandidateAttributes {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = attributes[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
    return undefined;
  };

  const email = pick("email", "emailAddress");
  const phone = pick("phone", "mobile", "phoneNumber");
  const name = pick("name", "fullName");
  const city = pick("city", "town");

  return {
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(city !== undefined ? { city } : {}),
  };
}
