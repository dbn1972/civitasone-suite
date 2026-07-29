/**
 * Reservation-roster shortlist domain (pure) — category-wise and location-wise
 * shortlisting with reservation controls (R-RA-0116). Implements the standard
 * Indian vertical-reservation model including the "meritorious reserved" rule: a
 * reserved-category candidate who qualifies on open merit is counted against the
 * UNRESERVED (UR) quota, freeing a reserved slot for the next reserved candidate.
 *
 * Horizontal reservations (PwD, ex-servicemen) overlay vertical categories and are
 * a documented follow-up — this module handles the vertical roster (UR/SC/ST/OBC/EWS).
 * No I/O; deterministic (merit desc, ties broken by applicationId).
 */

export const RESERVATION_CATEGORIES = ["UR", "SC", "ST", "OBC", "EWS"] as const;
export type ReservationCategory = (typeof RESERVATION_CATEGORIES)[number];
const RESERVED = ["SC", "ST", "OBC", "EWS"] as const; // categories with their own quota

export type Roster = Partial<Record<ReservationCategory, number>>;

export interface Candidate {
  applicationId: string;
  category: string;        // GEN/GENERAL/UR/SC/ST/OBC/EWS (case-insensitive)
  score: number;
  location?: string | null;
}

export interface Allocation {
  applicationId: string;
  category: ReservationCategory;    // the candidate's own (normalised) category
  allocatedAgainst: ReservationCategory; // the quota they occupy (UR for meritorious reserved)
  rank: number;                     // 1-based rank within allocatedAgainst
}
export interface WaitlistEntry { applicationId: string; category: ReservationCategory; rank: number }
export interface ShortlistResult {
  selected: Allocation[];
  waitlist: WaitlistEntry[];
  filled: Record<string, number>;   // allocatedAgainst -> count
  unmapped: string[];               // applicationIds excluded for an unrecognised category
}

/**
 * Explicit synonym map from real-world category codes to reservation categories.
 * Anything NOT in this map (including blank) returns null so it FAILS CLOSED —
 * a candidate is never silently reclassified as UR (which would strip a
 * constitutionally-protected reservation entitlement). Extend under policy review.
 */
const CATEGORY_SYNONYMS: Record<string, ReservationCategory> = {
  UR: "UR", GEN: "UR", GENERAL: "UR", UNRESERVED: "UR", OPEN: "UR",
  SC: "SC", ST: "ST",
  OBC: "OBC", "OBC-NCL": "OBC", OBCNCL: "OBC", "OBC NCL": "OBC", SEBC: "OBC", BC: "OBC", "OBC(NCL)": "OBC",
  EWS: "EWS",
};

/**
 * Normalise a free-text category to a reservation category, or `null` if it is
 * not a recognised code. Callers MUST treat null as "needs manual mapping",
 * never as UR (see unmappedCategories / the shortlist route's 422).
 */
export function normalizeCategory(c: string): ReservationCategory | null {
  const u = (c || "").trim().toUpperCase().replace(/\s+/g, " ");
  return CATEGORY_SYNONYMS[u] ?? null;
}

/** Application ids + raw category strings that do NOT map to a known category. */
export function unmappedCategories(candidates: readonly Candidate[]): Array<{ applicationId: string; category: string }> {
  return candidates.filter((c) => normalizeCategory(c.category) === null).map((c) => ({ applicationId: c.applicationId, category: c.category }));
}

/** Validation errors for a roster against a total (empty = valid). */
export function validateRoster(roster: Roster, totalVacancies: number): string[] {
  const errors: string[] = [];
  let sum = 0;
  for (const cat of RESERVATION_CATEGORIES) {
    const n = roster[cat];
    if (n != null) {
      if (!Number.isInteger(n) || n < 0) errors.push(`${cat} vacancies must be a non-negative integer`);
      else sum += n;
    }
  }
  if (sum !== totalVacancies) errors.push(`category vacancies (${sum}) must sum to the total vacancies (${totalVacancies})`);
  return errors;
}

function sortByMerit(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => (b.score - a.score) || (a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0));
}

/**
 * Allocate a category-wise shortlist against a single reservation roster.
 *  1. UR (open merit): the top `roster.UR` candidates by merit, regardless of
 *     category — reserved candidates selected here are meritorious-reserved.
 *  2. Each reserved category C: the top `roster[C]` candidates of category C not
 *     already selected against UR.
 *  3. Everyone remaining is waitlisted, ranked by merit within their own category.
 */
export function allocateShortlist(candidates: readonly Candidate[], roster: Roster): ShortlistResult {
  const sorted = sortByMerit(candidates);
  const catOf = new Map<string, ReservationCategory | null>(sorted.map((c) => [c.applicationId, normalizeCategory(c.category)]));
  const unmapped = sorted.filter((c) => catOf.get(c.applicationId) === null).map((c) => c.applicationId);
  const selectedSet = new Set<string>(unmapped); // exclude unmapped from any allocation (fail closed)
  const selected: Allocation[] = [];
  const filled: Record<string, number> = {};

  // 1. open-merit UR pass (any mapped category competes)
  const urSlots = roster.UR ?? 0;
  let urCount = 0;
  for (const c of sorted) {
    if (urCount >= urSlots) break;
    if (selectedSet.has(c.applicationId)) continue;
    selectedSet.add(c.applicationId);
    selected.push({ applicationId: c.applicationId, category: catOf.get(c.applicationId)!, allocatedAgainst: "UR", rank: ++urCount });
  }
  filled.UR = urCount;

  // 2. reserved-category passes
  for (const C of RESERVED) {
    const slots = roster[C] ?? 0;
    let count = 0;
    for (const c of sorted) {
      if (count >= slots) break;
      if (selectedSet.has(c.applicationId)) continue;
      if (catOf.get(c.applicationId) !== C) continue;
      selectedSet.add(c.applicationId);
      selected.push({ applicationId: c.applicationId, category: C, allocatedAgainst: C, rank: ++count });
    }
    filled[C] = count;
  }

  // 3. waitlist by own category (merit order); unmapped are excluded, reported separately
  const wlCount: Record<string, number> = {};
  const waitlist: WaitlistEntry[] = [];
  for (const c of sorted) {
    if (selectedSet.has(c.applicationId)) continue;
    const cat = catOf.get(c.applicationId);
    if (cat == null) continue;
    wlCount[cat] = (wlCount[cat] ?? 0) + 1;
    waitlist.push({ applicationId: c.applicationId, category: cat, rank: wlCount[cat]! });
  }

  return { selected, waitlist, filled, unmapped };
}

/**
 * Reconcile per-location rosters against the approved category vacancies: the sum
 * of each category across all locations must equal that category's total, so
 * location-mode shortlisting can never exceed the sanctioned reservation profile.
 */
export function validateLocationRosters(locationRosters: Record<string, Roster>, categoryVacancies: Roster): string[] {
  const errors: string[] = [];
  const agg: Record<string, number> = {};
  for (const [loc, r] of Object.entries(locationRosters)) {
    let locSum = 0;
    for (const cat of RESERVATION_CATEGORIES) {
      const n = r[cat];
      if (n == null) continue;
      if (!Number.isInteger(n) || n < 0) { errors.push(`location "${loc}" ${cat} must be a non-negative integer`); continue; }
      agg[cat] = (agg[cat] ?? 0) + n; locSum += n;
    }
    if (locSum <= 0) errors.push(`location "${loc}" roster has no vacancies`);
  }
  for (const cat of RESERVATION_CATEGORIES) {
    const want = categoryVacancies[cat] ?? 0;
    const got = agg[cat] ?? 0;
    if (got !== want) errors.push(`location rosters for ${cat} sum to ${got} but the approved roster has ${want}`);
  }
  return errors;
}

/**
 * Location-wise shortlist: partition candidates by location and allocate each
 * partition against that location's roster (R-RA-0116). Candidates whose location
 * has no roster are grouped under "" and skipped from allocation (returned in
 * `unlocated`).
 */
export function allocateByLocation(
  candidates: readonly Candidate[],
  locationRosters: Record<string, Roster>,
): { byLocation: Record<string, ShortlistResult>; unlocated: string[] } {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const loc = c.location ?? "";
    (groups.get(loc) ?? groups.set(loc, []).get(loc)!).push(c);
  }
  const byLocation: Record<string, ShortlistResult> = {};
  const unlocated: string[] = [];
  for (const [loc, group] of groups) {
    const roster = locationRosters[loc];
    if (!roster) { unlocated.push(...group.map((g) => g.applicationId)); continue; }
    byLocation[loc] = allocateShortlist(group, roster);
  }
  return { byLocation, unlocated };
}
