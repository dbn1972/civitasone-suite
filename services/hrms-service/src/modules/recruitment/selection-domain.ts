/**
 * Selection list domain (pure) — merit list + waitlist validation (R-RA-0153).
 * No I/O.
 */

export const ENTRY_CATEGORIES = ["selected", "waitlist"] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

export interface Entry {
  applicationId: string;
  category: string;
  rank: number;
}

/**
 * Validate a full set of selection-list entries against the vacancy count and
 * ranking rules (empty array of errors = valid):
 *  - every category is known;
 *  - each application appears at most once (not in both selected and waitlist);
 *  - ranks within a category are unique AND contiguous from 1 (1..N);
 *  - the number of SELECTED entries does not exceed the vacancies.
 */
export function validateEntries(entries: readonly Entry[], vacancies: number): string[] {
  const errors: string[] = [];
  const seenApp = new Set<string>();
  const byCat: Record<string, number[]> = { selected: [], waitlist: [] };

  for (const e of entries) {
    if (!(ENTRY_CATEGORIES as readonly string[]).includes(e.category)) {
      errors.push(`unknown category "${e.category}"`);
      continue;
    }
    if (seenApp.has(e.applicationId)) errors.push(`application ${e.applicationId} appears more than once`);
    seenApp.add(e.applicationId);
    if (!Number.isInteger(e.rank) || e.rank < 1) errors.push(`invalid rank ${e.rank} for application ${e.applicationId}`);
    else byCat[e.category]!.push(e.rank);
  }

  for (const cat of ENTRY_CATEGORIES) {
    const ranks = [...(byCat[cat] ?? [])].sort((a, b) => a - b);
    if (new Set(ranks).size !== ranks.length) errors.push(`duplicate ${cat} rank`);
    // contiguous from 1
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i] !== i + 1) { errors.push(`${cat} ranks must be contiguous from 1 (missing ${i + 1})`); break; }
    }
  }

  if (byCat.selected!.length > vacancies) {
    errors.push(`selected count (${byCat.selected!.length}) exceeds vacancies (${vacancies})`);
  }
  return errors;
}

/** A validity period is required to approve, and it must be in the future (by day). */
export function validateApproval(validUntil: string | null | undefined, nowMs: number): string[] {
  if (!validUntil) return ["a validity period (validUntil) is required to approve a selection list"];
  const t = Date.parse(validUntil);
  if (Number.isNaN(t)) return ["validUntil is not a valid date"];
  if (Math.floor(t / 86_400_000) < Math.floor(nowMs / 86_400_000)) return ["the validity period must not be in the past"];
  return [];
}

/** Is a selection list currently within its validity window? (expiry check, R-RA-0153) */
export function isWithinValidity(validUntil: string | null | undefined, nowMs: number): boolean {
  if (!validUntil) return false;
  const t = Date.parse(validUntil);
  if (Number.isNaN(t)) return false;
  return Math.floor(nowMs / 86_400_000) <= Math.floor(t / 86_400_000);
}
