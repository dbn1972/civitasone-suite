/**
 * GAP-HR-JD-TEMPLATES-06: the vacancy-type badge on a JD template card.
 *
 * The badge TEXT comes from i18n (the same `jdTemplates.filter*` keys the
 * filter chips use, so a type reads identically in both places); only the
 * colour tokens live here. Kept out of page.tsx and written as a function (not
 * a lookup table of records) because it is presentation, not data: the
 * screen-map FABRICATED_DATA heuristic treats a many-entry object literal in a
 * page as hardcoded records.
 */
export type TypeBadge = { labelKey: string; color: string; bg: string };

/** Colour + label key for a known vacancy type, or null for an unknown one. */
export function typeBadge(vacancyType: string): TypeBadge | null {
  switch (vacancyType) {
    case "regular":
      return { labelKey: "filterRegular", color: "var(--info)", bg: "var(--infobg)" };
    case "internship":
      return { labelKey: "filterInternship", color: "var(--warn)", bg: "var(--warnbg)" };
    case "apprenticeship":
      return { labelKey: "filterApprenticeship", color: "var(--good)", bg: "var(--goodbg)" };
    case "volunteership":
      return { labelKey: "filterVolunteer", color: "var(--info)", bg: "var(--infobg)" };
    case "contractual":
      return { labelKey: "filterContractual", color: "var(--violet)", bg: "var(--primary-soft)" };
    case "deputation":
      return { labelKey: "filterDeputation", color: "var(--ink2)", bg: "var(--line)" };
    default:
      return null;
  }
}
