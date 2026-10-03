/** Vertical reservation categories, matching hrms-service reservation-domain.ts RESERVATION_CATEGORIES. */
export const ROSTER_CATEGORIES = ["UR", "SC", "ST", "OBC", "EWS"] as const;
export type RosterCategory = (typeof ROSTER_CATEGORIES)[number];
export type GoiReservationCategory = "sc" | "st" | "obc" | "ews";

/** Statutory GOI vertical-reservation percentages (DoPT OM / GFR 2017; EWS 10% per the 103rd Amendment).
 * Used ONLY as guidance when a vacancy has no sanctioned roster -- the sanctioned roster is the source of truth. */
export const GOI_RESERVATION_QUOTA_PCT: Record<GoiReservationCategory, number> = {
  sc: 15, st: 7.5, obc: 27, ews: 10,
};

/** Application.category values that count as each roster category (matches reservation-domain.ts synonyms). */
const CATEGORY_ALIASES: Record<RosterCategory, string[]> = {
  UR: ["ur", "gen", "general", "unreserved", "open"],
  SC: ["sc"],
  ST: ["st"],
  OBC: ["obc", "obc-ncl", "obcncl", "obc ncl", "sebc", "bc", "obc(ncl)"],
  EWS: ["ews"],
};

export function categoryOfApplication(raw: string | null | undefined): RosterCategory | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return ROSTER_CATEGORIES.find((c) => CATEGORY_ALIASES[c].includes(v)) ?? null;
}


/**
 * Horizontal reservation groups (GAP-RECRUITMENT-DETAIL-03), matching hrms-service reservation-domain.ts
 * HORIZONTAL_CATEGORIES. They cut ACROSS the vertical categories, so they are counted separately and
 * never added into the vertical sum. PWBD = persons with benchmark disabilities (the statutory floor under
 * the RPwD Act 2016 is 4% of vacancies), EXSM = ex-servicemen, WOMEN = women.
 */
export const HORIZONTAL_CATEGORIES = ["PWBD", "EXSM", "WOMEN"] as const;
export type HorizontalCategory = (typeof HORIZONTAL_CATEGORIES)[number];

/** Errors (field keys) for a horizontal draft: each blank, or an integer between 0 and the total posts. */
export function horizontalDraftErrors(draft: Record<HorizontalCategory, string>, totalVacancies: number): HorizontalCategory[] {
  return HORIZONTAL_CATEGORIES.filter((k) => {
    const v = draft[k].trim();
    if (v === "") return false;
    const n = Number(v);
    return !Number.isInteger(n) || n < 0 || n > totalVacancies;
  });
}
